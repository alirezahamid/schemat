import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { IR_VERSION, parseSchema } from "@schemat/core";
import type {
  Column,
  Enum,
  IRSchema,
  ParserInput,
  Relation,
  SchemaParser,
  Table,
} from "@schemat/core";
import { Node, Project, SyntaxKind } from "ts-morph";
import type {
  ClassDeclaration,
  Decorator,
  ObjectLiteralExpression,
  PropertyDeclaration,
} from "ts-morph";

/**
 * @schemat/parser-mikroorm
 *
 * Static AST parser that converts MikroORM entity classes into the canonical
 * @schemat IR. Uses ts-morph to read the source; it NEVER connects to a
 * database, imports the app, or runs user code.
 */

const RELATION_DECORATORS = new Set(["OneToOne", "OneToMany", "ManyToOne", "ManyToMany"]);
const DEFAULT_COLUMN_TYPE = "string";

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkTsFiles(full, acc);
    } else if (
      entry.endsWith(".ts") &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".spec.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** True when a file imports from any `@mikro-orm/*` package. */
function fileImportsMikroOrm(path: string): boolean {
  const src = safeRead(path);
  return (
    /from\s+['"]@mikro-orm\/[^'"]+['"]/.test(src) ||
    /require\(\s*['"]@mikro-orm\/[^'"]+['"]\s*\)/.test(src)
  );
}

function fileHasEntityDecorator(path: string): boolean {
  return /@Entity\s*\(/.test(safeRead(path));
}

// ---------------------------------------------------------------------------
// detect()
// ---------------------------------------------------------------------------

async function detect(projectPath: string): Promise<boolean> {
  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<
        string,
        Record<string, string> | undefined
      >;
      for (const field of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ]) {
        const deps = pkg[field];
        if (deps) {
          for (const dep of Object.keys(deps)) {
            if (dep === "@mikro-orm/core" || dep.startsWith("@mikro-orm/")) return true;
          }
        }
      }
    } catch {
      // ignore malformed package.json
    }
  }

  // Require a `@mikro-orm` import signal so we don't false-positive TypeORM
  // (which also uses @Entity but imports from "typeorm").
  const tsFiles = walkTsFiles(projectPath);
  for (const f of tsFiles) {
    if (fileImportsMikroOrm(f)) return true;
  }
  for (const f of tsFiles) {
    if (fileHasEntityDecorator(f) && fileImportsMikroOrm(f)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Decorator option helpers
// ---------------------------------------------------------------------------

function getOptionsObject(dec: Decorator): ObjectLiteralExpression | undefined {
  for (const arg of dec.getArguments()) {
    const obj = arg.asKind(SyntaxKind.ObjectLiteralExpression);
    if (obj) return obj;
  }
  return undefined;
}

function getPropText(obj: ObjectLiteralExpression | undefined, name: string): string | undefined {
  if (!obj) return undefined;
  const prop = obj.getProperty(name);
  if (!prop) return undefined;
  const pa = prop.asKind(SyntaxKind.PropertyAssignment);
  if (!pa) return undefined;
  return pa.getInitializer()?.getText();
}

function getPropBool(obj: ObjectLiteralExpression | undefined, name: string): boolean | undefined {
  const t = getPropText(obj, name);
  if (t === "true") return true;
  if (t === "false") return false;
  return undefined;
}

function unquote(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const m = text.match(/^(['"`])([\s\S]*)\1$/);
  return m ? m[2] : text;
}

/** Extract the returned identifier of an arrow like `() => User` (strips `[]`, parens). */
function arrowReturnIdentifier(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const arrow = node.asKind(SyntaxKind.ArrowFunction);
  if (!arrow) return undefined;
  const txt = arrow.getBody().getText().replace(/\[\]$/, "").replace(/[()]/g, "").trim();
  return txt.length > 0 ? txt : undefined;
}

function tsTypeToColumnType(prop: PropertyDeclaration): string {
  const tn = prop.getTypeNode();
  if (!tn) return DEFAULT_COLUMN_TYPE;
  const text = tn.getText();
  switch (text) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "Date":
      return "timestamp";
    case "string":
      return "string";
    default:
      return text;
  }
}

function columnNameFor(
  opts: ObjectLiteralExpression | undefined,
  prop: PropertyDeclaration,
): string {
  return (
    unquote(getPropText(opts, "fieldName")) ?? unquote(getPropText(opts, "name")) ?? prop.getName()
  );
}

function readDefault(opts: ObjectLiteralExpression | undefined): string | null {
  const defaultText = getPropText(opts, "default");
  if (defaultText === undefined) return null;
  return unquote(defaultText) ?? defaultText;
}

// ---------------------------------------------------------------------------
// Column extraction
// ---------------------------------------------------------------------------

function extractPrimaryKey(prop: PropertyDeclaration, dec: Decorator): Column {
  const opts = getOptionsObject(dec);
  const declaredType = unquote(getPropText(opts, "type"));
  return {
    name: columnNameFor(opts, prop),
    type: declaredType ?? tsTypeToColumnType(prop),
    nullable: getPropBool(opts, "nullable") ?? false,
    isPrimaryKey: true,
    isUnique: getPropBool(opts, "unique") ?? false,
    default: readDefault(opts),
    comment: unquote(getPropText(opts, "comment")) ?? null,
  };
}

function extractProperty(prop: PropertyDeclaration, dec: Decorator): Column {
  const opts = getOptionsObject(dec);
  const declaredType = unquote(getPropText(opts, "type"));
  return {
    name: columnNameFor(opts, prop),
    type: declaredType ?? tsTypeToColumnType(prop),
    nullable: getPropBool(opts, "nullable") ?? false,
    isPrimaryKey: false,
    isUnique: getPropBool(opts, "unique") ?? false,
    default: readDefault(opts),
    comment: unquote(getPropText(opts, "comment")) ?? null,
  };
}

interface ExtractedEnum {
  column: Column;
  enum: Enum;
}

function extractEnum(
  prop: PropertyDeclaration,
  dec: Decorator,
  tableName: string,
  enumValues: Map<string, string[]>,
): ExtractedEnum {
  const opts = getOptionsObject(dec);
  const name = columnNameFor(opts, prop);
  const nullable = getPropBool(opts, "nullable") ?? false;
  const unique = getPropBool(opts, "unique") ?? false;
  const comment = unquote(getPropText(opts, "comment")) ?? null;
  const defaultVal = readDefault(opts);

  let type = "";
  let capturedEnum: Enum;

  // `@Enum(() => SomeEnum)` — arrow returning an identifier.
  let enumRef: string | undefined;
  for (const arg of dec.getArguments()) {
    const ref = arrowReturnIdentifier(arg);
    if (ref) {
      enumRef = ref;
      break;
    }
  }

  // `@Enum({ items: () => SomeEnum })` or `@Enum({ items: ['a','b'] })`.
  const itemsProp = opts?.getProperty("items");
  const itemsPa = itemsProp?.asKind(SyntaxKind.PropertyAssignment);
  const itemsInit = itemsPa?.getInitializer();

  if (itemsInit && Node.isArrayLiteralExpression(itemsInit)) {
    const values = itemsInit.getElements().map((el) => unquote(el.getText()) ?? el.getText());
    const enumName = `${tableName}_${name}_enum`;
    type = enumName;
    capturedEnum = { name: enumName, values };
  } else {
    const itemsRef = arrowReturnIdentifier(itemsInit);
    const ref = enumRef ?? itemsRef;
    if (ref) {
      type = ref;
      capturedEnum = { name: ref, values: enumValues.get(ref) ?? [] };
    } else {
      const fallback = tsTypeToColumnType(prop);
      type = fallback;
      capturedEnum = { name: fallback, values: enumValues.get(fallback) ?? [] };
    }
  }

  return {
    column: {
      name,
      type,
      nullable,
      isPrimaryKey: false,
      isUnique: unique,
      default: defaultVal,
      comment,
    },
    enum: capturedEnum,
  };
}

// ---------------------------------------------------------------------------
// Relation extraction
// ---------------------------------------------------------------------------

function relationTargetName(dec: Decorator): string | undefined {
  for (const arg of dec.getArguments()) {
    const ref = arrowReturnIdentifier(arg);
    if (ref) return ref;
    const id = arg.asKind(SyntaxKind.Identifier);
    if (id) return id.getText();
  }
  const opts = getOptionsObject(dec);
  const entityProp = opts?.getProperty("entity");
  const entityPa = entityProp?.asKind(SyntaxKind.PropertyAssignment);
  const ref = arrowReturnIdentifier(entityPa?.getInitializer());
  if (ref) return ref;
  return undefined;
}

/** MikroORM's owning side is the one WITHOUT `mappedBy`. */
function hasMappedBy(dec: Decorator): boolean {
  const opts = getOptionsObject(dec);
  return opts !== undefined && getPropText(opts, "mappedBy") !== undefined;
}

function extractRelation(
  prop: PropertyDeclaration,
  relDec: Decorator,
  thisTable: string,
  classToTable: Map<string, string>,
): Relation | undefined {
  const kind = relDec.getName();
  const ref = relationTargetName(relDec);
  if (!ref) return undefined;
  const target = classToTable.get(ref) ?? ref;
  const propName = prop.getName();
  const relName = `${thisTable}_${propName}`;
  const syntheticFk = `${propName}Id`;

  switch (kind) {
    case "ManyToOne":
      // Owning FK side. The IR has no `many-to-one`; represent it as
      // `one-to-many` from the owner.
      return {
        name: relName,
        fromTable: thisTable,
        fromColumns: [syntheticFk],
        toTable: target,
        toColumns: ["id"],
        cardinality: "one-to-many",
      };
    case "OneToOne":
      if (hasMappedBy(relDec)) return undefined;
      return {
        name: relName,
        fromTable: thisTable,
        fromColumns: [syntheticFk],
        toTable: target,
        toColumns: ["id"],
        cardinality: "one-to-one",
      };
    case "ManyToMany":
      // Only the owner (no mappedBy) emits the edge, once.
      if (hasMappedBy(relDec)) return undefined;
      return {
        name: relName,
        fromTable: thisTable,
        fromColumns: [],
        toTable: target,
        toColumns: [],
        cardinality: "many-to-many",
      };
    default:
      // @OneToMany is the inverse of @ManyToOne — skip to avoid duplicate edges.
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Entity extraction
// ---------------------------------------------------------------------------

function findEntityDecorator(cls: ClassDeclaration): Decorator | undefined {
  return cls.getDecorators().find((d) => d.getName() === "Entity");
}

function tableNameFor(cls: ClassDeclaration, entityDec: Decorator): string {
  const optName = unquote(getPropText(getOptionsObject(entityDec), "tableName"));
  if (optName) return optName;
  return cls.getName() ?? "UnnamedEntity";
}

function entityComment(entityDec: Decorator): string | null {
  return unquote(getPropText(getOptionsObject(entityDec), "comment")) ?? null;
}

function collectEntityFiles(input: ParserInput): string[] {
  if (input.files && input.files.length > 0) {
    return input.files.map((f) => (f.startsWith("/") ? f : join(input.projectPath, f)));
  }
  const all = walkTsFiles(input.projectPath);
  return all.filter((f) => f.endsWith(".entity.ts") || fileImportsMikroOrm(f));
}

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

async function parse(input: ParserInput): Promise<IRSchema> {
  const files = collectEntityFiles(input);

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
  });

  for (const f of files) {
    if (existsSync(f)) {
      try {
        project.addSourceFileAtPath(f);
      } catch {
        // skip unreadable files
      }
    }
  }

  const tables: Table[] = [];
  const relations: Relation[] = [];
  const enumMap = new Map<string, Enum>();

  // Pre-scan `enum X { ... }` declarations so identifier enum refs resolve.
  const enumValues = new Map<string, string[]>();
  for (const sf of project.getSourceFiles()) {
    for (const ed of sf.getEnums()) {
      const values = ed.getMembers().map((m) => {
        const init = m.getInitializer();
        if (init) return unquote(init.getText()) ?? init.getText();
        return m.getName();
      });
      enumValues.set(ed.getName(), values);
    }
  }

  // First pass: entity CLASS name -> table name, so relation targets resolve.
  const classToTable = new Map<string, string>();
  for (const sf of project.getSourceFiles()) {
    for (const cls of sf.getClasses()) {
      const entityDec = findEntityDecorator(cls);
      if (!entityDec) continue;
      const clsName = cls.getName();
      if (clsName) classToTable.set(clsName, tableNameFor(cls, entityDec));
    }
  }

  for (const sf of project.getSourceFiles()) {
    for (const cls of sf.getClasses()) {
      const entityDec = findEntityDecorator(cls);
      if (!entityDec) continue;

      const tableName = tableNameFor(cls, entityDec);
      const columns: Column[] = [];

      for (const prop of cls.getProperties()) {
        const decs = prop.getDecorators();
        if (decs.length === 0) continue;

        const pk = decs.find((d) => d.getName() === "PrimaryKey");
        if (pk) {
          columns.push(extractPrimaryKey(prop, pk));
          continue;
        }

        const enumDec = decs.find((d) => d.getName() === "Enum");
        if (enumDec) {
          const { column, enum: en } = extractEnum(prop, enumDec, tableName, enumValues);
          columns.push(column);
          if (en && !enumMap.has(en.name)) enumMap.set(en.name, en);
          continue;
        }

        const propDec = decs.find((d) => d.getName() === "Property");
        if (propDec) {
          columns.push(extractProperty(prop, propDec));
          continue;
        }

        const relDec = decs.find((d) => RELATION_DECORATORS.has(d.getName()));
        if (relDec) {
          const rel = extractRelation(prop, relDec, tableName, classToTable);
          if (rel) relations.push(rel);
        }
      }

      tables.push({ name: tableName, columns, comment: entityComment(entityDec) });
    }
  }

  const schema: IRSchema = {
    version: IR_VERSION,
    tables,
    enums: [...enumMap.values()],
    relations,
  };

  return parseSchema(schema);
}

export const mikroormParser: SchemaParser = { name: "mikroorm", detect, parse };

export default mikroormParser;
