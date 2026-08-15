/**
 * @schemat/parser-sequelize
 *
 * Static AST parser: Sequelize model definitions -> canonical IR.
 * Never connects to a DB, never imports the app, never executes user code.
 *
 * Supported:
 *   - sequelize.define('Name', attrs, options)
 *   - Model.init(attrs, { sequelize, modelName, tableName })
 *   - associations: belongsTo / hasMany / hasOne / belongsToMany
 *
 * Not covered (v1): sequelize-typescript decorators, dynamic attribute builders.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { IR_VERSION, mapToCanonicalType, parseSchema } from "@schemat/core";
import type {
  CanonicalType,
  Cardinality,
  Column,
  Enum,
  IRSchema,
  ParserInput,
  ParserResult,
  Relation,
  SchemaParser,
  Table,
} from "@schemat/core";
import { Node, Project, SyntaxKind } from "ts-morph";
import type {
  CallExpression,
  ObjectLiteralExpression,
  PropertyAssignment,
  SourceFile,
} from "ts-morph";

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walkSourceFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === "build") {
      continue;
    }
    const full = join(dir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkSourceFiles(full, acc);
    } else if (
      (entry.endsWith(".ts") ||
        entry.endsWith(".js") ||
        entry.endsWith(".mjs") ||
        entry.endsWith(".cjs")) &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".spec.ts") &&
      !entry.endsWith(".test.js") &&
      !entry.endsWith(".spec.js")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

function hasSequelizeDep(projectPath: string): boolean {
  const pkgPath = join(projectPath, "package.json");
  if (!existsSync(pkgPath)) return false;
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
      if (
        deps &&
        (Object.prototype.hasOwnProperty.call(deps, "sequelize") ||
          Object.prototype.hasOwnProperty.call(deps, "sequelize-typescript"))
      ) {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function fileLooksSequelize(path: string): boolean {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  // Model definition files usually import sequelize; association-only files may
  // only call belongsTo/hasMany/etc. on imported models.
  const hasSequelizeImport =
    /\bsequelize\b/i.test(text) || /from\s+['"]sequelize(?:-typescript)?['"]/.test(text);
  const hasModelShape = /\.define\s*\(/.test(text) || /\.init\s*\(/.test(text);
  const hasAssocShape =
    /\.belongsTo\s*\(/.test(text) ||
    /\.hasMany\s*\(/.test(text) ||
    /\.hasOne\s*\(/.test(text) ||
    /\.belongsToMany\s*\(/.test(text);
  if (hasModelShape && hasSequelizeImport) return true;
  if (hasAssocShape) return true;
  return false;
}

async function detect(projectPath: string): Promise<boolean> {
  if (hasSequelizeDep(projectPath)) return true;
  for (const f of walkSourceFiles(projectPath)) {
    if (fileLooksSequelize(f)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function unquote(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const m = text.match(/^(['"`])([\s\S]*)\1$/);
  return m ? m[2] : text;
}

function literalText(node: Node | undefined): string | null {
  if (!node) return null;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isNumericLiteral(node)) return node.getText();
  if (node.getKind() === SyntaxKind.TrueKeyword) return "true";
  if (node.getKind() === SyntaxKind.FalseKeyword) return "false";
  if (node.getKind() === SyntaxKind.NullKeyword) return "null";
  return null;
}

function propAssign(obj: ObjectLiteralExpression, name: string): PropertyAssignment | undefined {
  const prop = obj.getProperty(name);
  if (!prop || !Node.isPropertyAssignment(prop)) return undefined;
  return prop;
}

function propInit(obj: ObjectLiteralExpression | undefined, name: string): Node | undefined {
  if (!obj) return undefined;
  return propAssign(obj, name)?.getInitializer();
}

function propBool(obj: ObjectLiteralExpression | undefined, name: string): boolean {
  const init = propInit(obj, name);
  return init?.getKind() === SyntaxKind.TrueKeyword;
}

function propString(obj: ObjectLiteralExpression | undefined, name: string): string | undefined {
  const lit = literalText(propInit(obj, name));
  return lit ?? undefined;
}

function asObjectLiteral(node: Node | undefined): ObjectLiteralExpression | undefined {
  if (!node) return undefined;
  return Node.isObjectLiteralExpression(node) ? node : undefined;
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

interface MappedSequelizeType {
  /** Dialect token fed to mapToCanonicalType (never free-form into Column.type). */
  mapKey: string;
  /** Source display string stored on Column.rawType. */
  rawType: string;
  isList: boolean;
  enumValues?: string[];
}

/**
 * Parse a Sequelize DataTypes / Sequelize.* type expression.
 * Returns a mapKey for {@link mapToCanonicalType}, the raw source text, and
 * list/enum metadata. ARRAY(...) sets isList and maps the element type.
 */
function mapDataType(typeText: string): MappedSequelizeType {
  const t = typeText.replace(/\s+/g, " ").trim();
  const rawType = t || "unknown";

  // DataTypes.ENUM('a','b') / Sequelize.ENUM('a','b')
  const enumM = t.match(/(?:DataTypes|Sequelize)\.ENUM\s*\(([\s\S]*)\)\s*$/);
  if (enumM?.[1] !== undefined) {
    const raw = enumM[1];
    const values = [...raw.matchAll(/(['"])(.*?)\1/g)]
      .map((m) => m[2])
      .filter((v): v is string => typeof v === "string");
    return { mapKey: "enum", rawType, isList: false, enumValues: values };
  }

  // DataTypes.ARRAY(DataTypes.STRING) / Sequelize.ARRAY(...)
  const arrM = t.match(/(?:DataTypes|Sequelize)\.ARRAY\s*\(([\s\S]*)\)\s*$/);
  if (arrM?.[1] !== undefined) {
    const inner = mapDataType(arrM[1].trim());
    return {
      mapKey: inner.mapKey,
      rawType,
      isList: true,
      enumValues: inner.enumValues,
    };
  }

  // DataTypes.STRING(255) / INTEGER / etc.
  const dt = t.match(/(?:DataTypes|Sequelize)\.([A-Z_]+)(?:\s*\(([\s\S]*)\))?/);
  if (dt?.[1]) {
    const base = dt[1].toUpperCase();
    // mapKey is the Sequelize base name; mapToCanonicalType lowercases + maps.
    // Special cases that need a friendlier key for the shared mapper:
    let mapKey = base.toLowerCase();
    if (base === "DOUBLEPRECISION") mapKey = "double precision";
    if (base === "DATEONLY") mapKey = "date";
    if (base === "DATE") mapKey = "datetime";
    if (base === "UUIDV1" || base === "UUIDV4") mapKey = "uuid";
    if (base === "ENUM") {
      return { mapKey: "enum", rawType, isList: false, enumValues: [] };
    }
    if (base === "ARRAY") {
      // Bare ARRAY without element arg — treat as list of unknown
      return { mapKey: "unknown", rawType, isList: true };
    }
    return { mapKey, rawType, isList: false };
  }

  // Bare identifier fallback (e.g. imported alias)
  const bare = (t.split(".").pop() ?? t).trim();
  return { mapKey: bare || "unknown", rawType, isList: false };
}

// ---------------------------------------------------------------------------
// Attribute parsing
// ---------------------------------------------------------------------------

interface ParsedModel {
  /** Class / variable / define name used in associations. */
  modelKey: string;
  tableName: string;
  columns: Column[];
  enums: Enum[];
}

function parseAttribute(
  name: string,
  valueNode: Node,
  modelKey: string,
): {
  column: Column;
  enumDef?: Enum;
} {
  // Shorthand: field: DataTypes.STRING
  let typeNode: Node | undefined = valueNode;
  let opts: ObjectLiteralExpression | undefined;

  if (Node.isObjectLiteralExpression(valueNode)) {
    opts = valueNode;
    typeNode = propInit(valueNode, "type") ?? valueNode;
  }

  const typeText = typeNode?.getText() ?? "unknown";
  const mapped = mapDataType(typeText);

  // Sequelize default allowNull:true unless primaryKey
  let nullable = true;
  if (opts) {
    const an = propInit(opts, "allowNull");
    if (an?.getKind() === SyntaxKind.FalseKeyword) nullable = false;
    else if (an?.getKind() === SyntaxKind.TrueKeyword) nullable = true;
  }

  const isPrimaryKey = propBool(opts, "primaryKey");
  const isUnique = propBool(opts, "unique");
  // unique can also be a string constraint name — treat as unique
  const uniqueInit = propInit(opts, "unique");
  const unique =
    isUnique ||
    (uniqueInit !== undefined &&
      uniqueInit.getKind() !== SyntaxKind.FalseKeyword &&
      uniqueInit.getKind() !== SyntaxKind.NullKeyword);

  const defaultInit = propInit(opts, "defaultValue");
  const defaultVal = defaultInit ? (literalText(defaultInit) ?? defaultInit.getText()) : null;

  const colName = propString(opts, "field") ?? name;

  let type: CanonicalType = mapToCanonicalType(mapped.mapKey);
  let rawType = mapped.rawType;
  let enumDef: Enum | undefined;
  // Enum: closed type "enum"; rawType keeps the generated enum name (display).
  if (mapped.enumValues !== undefined) {
    const enumName = `${modelKey}_${colName}_enum`;
    type = "enum";
    rawType = enumName;
    enumDef = { name: enumName, values: mapped.enumValues };
  }

  // primaryKey implies not null
  if (isPrimaryKey) nullable = false;

  return {
    column: {
      name: colName,
      type,
      rawType,
      nullable,
      isPrimaryKey,
      isUnique: unique || isPrimaryKey,
      isList: mapped.isList,
      default: defaultVal,
      comment: propString(opts, "comment") ?? null,
    },
    enumDef,
  };
}

function parseAttributesObject(
  attrs: ObjectLiteralExpression,
  modelKey: string,
): { columns: Column[]; enums: Enum[] } {
  const columns: Column[] = [];
  const enums: Enum[] = [];
  for (const prop of attrs.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const name = prop.getName().replace(/^['"]|['"]$/g, "");
    const init = prop.getInitializer();
    if (!init) continue;
    // Skip association helper props that aren't columns (rare in attrs)
    const { column, enumDef } = parseAttribute(name, init, modelKey);
    columns.push(column);
    if (enumDef) enums.push(enumDef);
  }
  return { columns, enums };
}

// ---------------------------------------------------------------------------
// Model extraction: define() + init()
// ---------------------------------------------------------------------------

function callCalleeName(call: CallExpression): string {
  const expr = call.getExpression();
  if (Node.isPropertyAccessExpression(expr)) return expr.getName();
  if (Node.isIdentifier(expr)) return expr.getText();
  return expr.getText();
}

function extractDefine(call: CallExpression): ParsedModel | undefined {
  if (callCalleeName(call) !== "define") return undefined;
  const args = call.getArguments();
  if (args.length < 2) return undefined;

  const nameLit = literalText(args[0]);
  if (!nameLit) return undefined;
  const attrs = asObjectLiteral(args[1]);
  if (!attrs) return undefined;
  const opts = asObjectLiteral(args[2]);

  const tableName = propString(opts, "tableName") ?? nameLit;
  const { columns, enums } = parseAttributesObject(attrs, nameLit);
  return { modelKey: nameLit, tableName, columns, enums };
}

function extractInit(call: CallExpression): ParsedModel | undefined {
  if (callCalleeName(call) !== "init") return undefined;
  const args = call.getArguments();
  if (args.length < 2) return undefined;

  const attrs = asObjectLiteral(args[0]);
  const opts = asObjectLiteral(args[1]);
  if (!attrs || !opts) return undefined;

  // Model.init must reference sequelize in options. Accept shorthand `{ sequelize }`.
  if (!opts.getProperty("sequelize")) return undefined;

  // modelKey from receiver: User.init(...) or from modelName option
  let modelKey = propString(opts, "modelName");
  if (!modelKey) {
    const expr = call.getExpression();
    if (Node.isPropertyAccessExpression(expr)) {
      modelKey = expr.getExpression().getText();
    }
  }
  if (!modelKey) return undefined;

  // Strip namespace/module prefixes: models.User -> User
  modelKey = modelKey.split(".").pop() ?? modelKey;

  const tableName = propString(opts, "tableName") ?? modelKey;
  const { columns, enums } = parseAttributesObject(attrs, modelKey);
  return { modelKey, tableName, columns, enums };
}

// ---------------------------------------------------------------------------
// Association extraction
// ---------------------------------------------------------------------------

interface PendingAssoc {
  kind: "belongsTo" | "hasMany" | "hasOne" | "belongsToMany";
  fromKey: string;
  toExpr: string;
  as?: string;
  foreignKey?: string;
  through?: string;
}

function resolveTargetKey(expr: Node): string {
  // () => User  /  User  /  models.User
  if (Node.isArrowFunction(expr)) {
    const body = expr.getBody();
    return resolveTargetKey(body);
  }
  if (Node.isIdentifier(expr) || Node.isPropertyAccessExpression(expr)) {
    return expr.getText().split(".").pop() ?? expr.getText();
  }
  // call / other — last identifier-ish token
  const t = expr.getText().replace(/[()]/g, "").trim();
  return t.split(".").pop() ?? t;
}

function extractAssociation(call: CallExpression): PendingAssoc | undefined {
  const kind = callCalleeName(call);
  if (kind !== "belongsTo" && kind !== "hasMany" && kind !== "hasOne" && kind !== "belongsToMany") {
    return undefined;
  }
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return undefined;
  const fromKey = expr.getExpression().getText().split(".").pop() ?? expr.getExpression().getText();
  const args = call.getArguments();
  if (args.length < 1) return undefined;
  const targetArg = args[0];
  if (!targetArg) return undefined;

  const toKey = resolveTargetKey(targetArg);
  const opts = asObjectLiteral(args[1]);
  const as = propString(opts, "as");
  const fkInit = propInit(opts, "foreignKey");
  let foreignKey: string | undefined;
  if (fkInit) {
    if (Node.isObjectLiteralExpression(fkInit)) {
      foreignKey = propString(fkInit, "name") ?? propString(fkInit, "field");
    } else {
      foreignKey = literalText(fkInit) ?? undefined;
    }
  }
  let through: string | undefined;
  const throughInit = propInit(opts, "through");
  if (throughInit) {
    through = literalText(throughInit) ?? resolveTargetKey(throughInit);
  }

  return { kind, fromKey, toExpr: toKey, as, foreignKey, through };
}

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

function collectFiles(input: ParserInput): string[] {
  if (input.files && input.files.length > 0) {
    return input.files.map((f) => (f.startsWith("/") ? f : join(input.projectPath, f)));
  }
  return walkSourceFiles(input.projectPath).filter(fileLooksSequelize);
}

async function parse(input: ParserInput): Promise<ParserResult> {
  const files = collectFiles(input);
  const warnings: string[] = [];

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true },
  });

  for (const f of files) {
    if (existsSync(f)) project.addSourceFileAtPath(f);
  }

  const models = new Map<string, ParsedModel>(); // modelKey -> model
  const assocs: PendingAssoc[] = [];

  const visitCalls = (sf: SourceFile) => {
    sf.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const defined = extractDefine(node);
      if (defined) {
        models.set(defined.modelKey, defined);
        return;
      }
      const inited = extractInit(node);
      if (inited) {
        models.set(inited.modelKey, inited);
        return;
      }
      const assoc = extractAssociation(node);
      if (assoc) assocs.push(assoc);
    });
  };

  for (const sf of project.getSourceFiles()) visitCalls(sf);

  // Also index by tableName for association resolution fallbacks
  const keyToTable = new Map<string, string>();
  for (const m of models.values()) {
    keyToTable.set(m.modelKey, m.tableName);
    keyToTable.set(m.tableName, m.tableName);
  }

  const tables: Table[] = [];
  const enumMap = new Map<string, Enum>();
  for (const m of models.values()) {
    tables.push({ name: m.tableName, columns: m.columns, comment: null });
    for (const e of m.enums) {
      if (!enumMap.has(e.name)) enumMap.set(e.name, e);
    }
  }

  const relations: Relation[] = [];
  const seenRel = new Set<string>();

  for (const a of assocs) {
    const fromTable = keyToTable.get(a.fromKey);
    const toTable = keyToTable.get(a.toExpr);
    if (!fromTable || !toTable) {
      warnings.push(
        `Sequelize association ${a.fromKey}.${a.kind}(${a.toExpr}) skipped — unresolved model.`,
      );
      continue;
    }

    let cardinality: Cardinality;
    let fromColumns: string[] = [];
    let toColumns: string[] = [];
    let ownerFrom = fromTable;
    let ownerTo = toTable;

    switch (a.kind) {
      case "belongsTo": {
        // from owns FK -> to
        cardinality = "one-to-many";
        const fk = a.foreignKey ?? `${a.toExpr.charAt(0).toLowerCase()}${a.toExpr.slice(1)}Id`;
        fromColumns = [fk];
        toColumns = ["id"];
        break;
      }
      case "hasMany": {
        // Inverse of belongsTo. Skip — owning side (belongsTo) already emits the FK edge.
        continue;
      }
      case "hasOne": {
        cardinality = "one-to-one";
        if (a.foreignKey) {
          // FK on target
          ownerFrom = toTable;
          ownerTo = fromTable;
          fromColumns = [a.foreignKey];
          toColumns = ["id"];
        } else {
          const fk = `${a.fromKey.charAt(0).toLowerCase()}${a.fromKey.slice(1)}Id`;
          ownerFrom = toTable;
          ownerTo = fromTable;
          fromColumns = [fk];
          toColumns = ["id"];
        }
        break;
      }
      case "belongsToMany": {
        cardinality = "many-to-many";
        fromColumns = [];
        toColumns = [];
        break;
      }
      default:
        continue;
    }

    const relName =
      a.as ??
      (a.kind === "belongsToMany"
        ? `${ownerFrom}_${ownerTo}_m2m`
        : `${ownerFrom}_${fromColumns[0] ?? "rel"}_${ownerTo}`);

    if (seenRel.has(relName)) continue;
    seenRel.add(relName);

    relations.push({
      name: relName,
      fromTable: ownerFrom,
      fromColumns,
      toTable: ownerTo,
      toColumns,
      cardinality,
    });
  }

  // Stable order for diffs
  tables.sort((a, b) => a.name.localeCompare(b.name));
  relations.sort((a, b) => a.name.localeCompare(b.name));

  const schema: IRSchema = {
    version: IR_VERSION,
    tables,
    enums: [...enumMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    relations,
  };

  return { schema: parseSchema(schema), warnings };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const sequelizeParser: SchemaParser = {
  name: "sequelize",
  detect,
  parse,
  watchTargets: (projectPath) => [projectPath],
};

export default sequelizeParser;
