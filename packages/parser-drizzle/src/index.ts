import { access, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { Node, Project } from "ts-morph";
import type {
  ArrowFunction,
  CallExpression,
  Expression,
  ObjectLiteralExpression,
  SourceFile,
} from "ts-morph";

import { IR_VERSION, parseSchema } from "@schemat/core";
import type {
  Cardinality,
  Column,
  Enum,
  IRSchema,
  ParserInput,
  Relation,
  SchemaParser,
  Table,
} from "@schemat/core";

/** Drizzle table-builder factory names we recognise. */
const TABLE_FNS = new Set(["pgTable", "mysqlTable", "sqliteTable"]);

/** Schema files we probe when the caller does not pin `input.files`. */
const COMMON_SCHEMA_FILES = [
  "src/schema.ts",
  "src/db/schema.ts",
  "db/schema.ts",
  "drizzle/schema.ts",
  "src/drizzle/schema.ts",
];

const DRIZZLE_CONFIG_FILES = ["drizzle.config.ts", "drizzle.config.json"];

// ---------------------------------------------------------------------------
// Small fs helpers
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/** First string-literal argument of a call, or null. */
function firstStringArg(args: readonly Node[]): string | null {
  for (const a of args) {
    if (Node.isStringLiteral(a) || Node.isNoSubstitutionTemplateLiteral(a)) {
      return a.getLiteralText();
    }
  }
  return null;
}

/** The object-literal argument of a table call (the columns map). */
function objectLiteralArg(args: readonly Node[]): ObjectLiteralExpression | null {
  for (const a of args) {
    if (Node.isObjectLiteralExpression(a)) return a;
  }
  return null;
}

interface ChainMethod {
  name: string;
  args: Node[];
}

interface Chain {
  /** Column-builder identifier at the base of the chain, e.g. `serial`, `varchar`. */
  builder: string | null;
  /** Arguments passed to the base builder call. */
  baseArgs: Node[];
  /** Chained methods, outermost first, e.g. `.notNull().primaryKey()`. */
  methods: ChainMethod[];
}

/**
 * Unwind a chained column expression such as
 *   varchar('email', { length: 255 }).notNull().unique()
 * into its base builder plus the list of chained method calls.
 */
function unwindChain(expr: Expression): Chain {
  const methods: ChainMethod[] = [];
  let node: Node = expr;

  while (Node.isCallExpression(node)) {
    const call: CallExpression = node;
    const callee = call.getExpression();

    if (Node.isPropertyAccessExpression(callee)) {
      methods.push({ name: callee.getName(), args: call.getArguments() });
      node = callee.getExpression();
      continue;
    }

    if (Node.isIdentifier(callee)) {
      // Reached the base builder call, e.g. `serial('id')`.
      return { builder: callee.getText(), baseArgs: call.getArguments(), methods };
    }

    // Something we do not model (e.g. computed callee) — stop.
    break;
  }

  return { builder: null, baseArgs: [], methods };
}

/** Extract `() => table.column` from a `.references(...)` first argument. */
function readReferenceTarget(args: readonly Node[]): { varName: string; propKey: string } | null {
  const first = args[0];
  if (!first || !Node.isArrowFunction(first)) return null;
  const arrow: ArrowFunction = first;

  let body: Node = arrow.getBody();
  // Support both `() => t.id` and `() => { return t.id }`.
  if (Node.isBlock(body)) {
    const ret = body.getStatements().find((s) => Node.isReturnStatement(s));
    if (ret && Node.isReturnStatement(ret)) {
      const rexpr = ret.getExpression();
      if (!rexpr) return null;
      body = rexpr;
    } else {
      return null;
    }
  }

  if (Node.isPropertyAccessExpression(body)) {
    const target = body.getExpression();
    return { varName: target.getText(), propKey: body.getName() };
  }
  return null;
}

/** Read the string values of an array-literal argument (`['a','b']`). */
function readStringArray(arg: Node | undefined): string[] {
  if (!arg || !Node.isArrayLiteralExpression(arg)) return [];
  const out: string[] = [];
  for (const el of arg.getElements()) {
    if (Node.isStringLiteral(el) || Node.isNoSubstitutionTemplateLiteral(el)) {
      out.push(el.getLiteralText());
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Intermediate collection shapes (pre-resolution)
// ---------------------------------------------------------------------------

interface RawRef {
  fromColumn: string; // db column name on the owning side
  toVarName: string; // JS variable name of the referenced table
  toPropKey: string; // JS property key of the referenced column
  ownerUnique: boolean; // owning column is unique/pk -> one-to-one
}

interface RawTable {
  varName: string;
  tableName: string;
  columns: Column[];
  /** propertyKey -> db column name, used to resolve `.references()` targets. */
  propToDbCol: Map<string, string>;
  refs: RawRef[];
}

// ---------------------------------------------------------------------------
// Core extraction
// ---------------------------------------------------------------------------

function extractColumn(
  propKey: string,
  chain: Chain,
): { column: Column; ref: Omit<RawRef, "fromColumn"> | null } {
  const dbName = firstStringArg(chain.baseArgs) ?? propKey;
  const type = chain.builder ?? "unknown";

  let isPrimaryKey = false;
  let isUnique = false;
  let notNull = false;
  let defaultVal: string | null = null;
  let ref: Omit<RawRef, "fromColumn"> | null = null;

  for (const m of chain.methods) {
    switch (m.name) {
      case "primaryKey":
        isPrimaryKey = true;
        break;
      case "unique":
        isUnique = true;
        break;
      case "notNull":
        notNull = true;
        break;
      case "default":
        defaultVal = m.args[0] ? m.args[0].getText() : null;
        break;
      case "defaultNow":
        defaultVal = "now()";
        break;
      case "defaultRandom":
        defaultVal = "random()";
        break;
      case "references": {
        const target = readReferenceTarget(m.args);
        if (target) {
          ref = { toVarName: target.varName, toPropKey: target.propKey, ownerUnique: false };
        }
        break;
      }
      default:
        break;
    }
  }

  const column: Column = {
    name: dbName,
    type,
    // A primary key is implicitly NOT NULL.
    nullable: !(notNull || isPrimaryKey),
    isPrimaryKey,
    isUnique,
    default: defaultVal,
    comment: null,
  };

  if (ref) ref.ownerUnique = isUnique || isPrimaryKey;

  return { column, ref };
}

function extractTable(varName: string, call: CallExpression): RawTable | null {
  const args = call.getArguments();
  const tableName = firstStringArg(args);
  if (tableName === null) return null;

  const obj = objectLiteralArg(args);
  const columns: Column[] = [];
  const propToDbCol = new Map<string, string>();
  const refs: RawRef[] = [];

  if (obj) {
    for (const prop of obj.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;
      const propKey = prop.getName();
      const init = prop.getInitializer();
      if (!init) continue;

      const chain = unwindChain(init);
      // Skip entries that are not column builders (e.g. table-level indexes
      // sometimes authored inside the columns object are still call chains,
      // but a null builder means we could not resolve one).
      const { column, ref } = extractColumn(propKey, chain);
      columns.push(column);
      propToDbCol.set(propKey, column.name);
      if (ref) refs.push({ fromColumn: column.name, ...ref });
    }
  }

  return { varName, tableName, columns, propToDbCol, refs };
}

function extractEnum(call: CallExpression): Enum | null {
  const args = call.getArguments();
  const name = firstStringArg(args);
  if (name === null) return null;
  const values = readStringArray(args[1]);
  return { name, values };
}

/** Return the callee identifier text of a call, if it is a plain identifier. */
function calleeName(call: CallExpression): string | null {
  const callee = call.getExpression();
  return Node.isIdentifier(callee) ? callee.getText() : null;
}

function collectFromSourceFile(sf: SourceFile, rawTables: RawTable[], enums: Enum[]): void {
  for (const decl of sf.getVariableDeclarations()) {
    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const fn = calleeName(init);
    if (fn === null) continue;

    if (TABLE_FNS.has(fn)) {
      const t = extractTable(decl.getName(), init);
      if (t) rawTables.push(t);
    } else if (fn === "pgEnum") {
      const e = extractEnum(init);
      if (e) enums.push(e);
    }
  }
}

function resolveRelations(rawTables: RawTable[]): Relation[] {
  // Map JS variable name -> resolved table (name + column lookup).
  const byVar = new Map<string, RawTable>();
  for (const t of rawTables) byVar.set(t.varName, t);

  const relations: Relation[] = [];
  for (const t of rawTables) {
    for (const ref of t.refs) {
      const target = byVar.get(ref.toVarName);
      const toTable = target ? target.tableName : ref.toVarName;
      const toColumn = target
        ? (target.propToDbCol.get(ref.toPropKey) ?? ref.toPropKey)
        : ref.toPropKey;
      const cardinality: Cardinality = ref.ownerUnique ? "one-to-one" : "one-to-many";

      relations.push({
        name: `${t.tableName}_${ref.fromColumn}_${toTable}_fk`,
        fromTable: t.tableName,
        fromColumns: [ref.fromColumn],
        toTable,
        toColumns: [toColumn],
        cardinality,
      });
    }
  }
  return relations;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

async function locateSchemaFiles(input: ParserInput): Promise<string[]> {
  const root = input.projectPath;

  if (input.files && input.files.length > 0) {
    const abs = input.files.map((f) => (isAbsolute(f) ? f : resolve(root, f)));
    const found: string[] = [];
    for (const f of abs) if (await pathExists(f)) found.push(f);
    return found;
  }

  const found: string[] = [];
  for (const rel of COMMON_SCHEMA_FILES) {
    const p = join(root, rel);
    if (await pathExists(p)) found.push(p);
  }
  return found;
}

function hasDrizzleDependency(pkg: Record<string, unknown> | null): boolean {
  if (!pkg) return false;
  for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[key];
    if (deps && typeof deps === "object" && "drizzle-orm" in (deps as object)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Parser implementation
// ---------------------------------------------------------------------------

async function detect(projectPath: string): Promise<boolean> {
  // 1. A drizzle.config.* file is the strongest signal.
  for (const cfg of DRIZZLE_CONFIG_FILES) {
    if (await pathExists(join(projectPath, cfg))) return true;
  }

  // 2. drizzle-orm dependency + at least one schema file.
  const pkg = await readJson(join(projectPath, "package.json"));
  const schemaFiles = await locateSchemaFiles({ projectPath });
  if (hasDrizzleDependency(pkg) && schemaFiles.length > 0) return true;

  // 3. A conventional schema file exists on its own.
  if (schemaFiles.length > 0) return true;

  return false;
}

async function parse(input: ParserInput): Promise<IRSchema> {
  const files = await locateSchemaFiles(input);

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, noEmit: true },
  });

  const rawTables: RawTable[] = [];
  const enums: Enum[] = [];

  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    // createSourceFile never type-checks or executes — pure static parse. A
    // syntactically malformed file yields a partial AST rather than throwing,
    // so we simply extract whatever declarations resolved cleanly.
    const sf = project.createSourceFile(file, text, { overwrite: true });
    collectFromSourceFile(sf, rawTables, enums);
  }

  const tables: Table[] = rawTables.map((t) => ({
    name: t.tableName,
    columns: t.columns,
    comment: null,
  }));
  const relations = resolveRelations(rawTables);

  const schema: IRSchema = {
    version: IR_VERSION,
    tables,
    enums,
    relations,
  };

  // Validate against the canonical contract before returning.
  return parseSchema(schema);
}

export const drizzleParser: SchemaParser = { name: "drizzle", detect, parse };

export default drizzleParser;
