/**
 * @schemat/parser-mongoose
 *
 * Static AST parser that converts Mongoose schema definitions into the canonical
 * @schemat IR shape. Uses ts-morph to read the source; it NEVER connects to
 * MongoDB, never imports the app, and never executes user code.
 *
 * IMPORTANT CAVEAT
 * ----------------
 * MongoDB is schemaless at the database level. This parser reads the
 * APPLICATION-level Mongoose schema — a *logical* model expressed in code — not a
 * physical database schema. In particular:
 *   - "Tables" here are Mongoose models (collections), not SQL tables.
 *   - "Relations" are derived from Mongoose `ref` conventions. They are NOT
 *     physical foreign keys; MongoDB does not enforce them.
 *   - Every model gets an implicit `_id` primary key (ObjectId), matching
 *     Mongoose/Mongo behaviour where `_id` is auto-added.
 *
 * v1 SIMPLIFICATION
 * -----------------
 * Nested subdocuments (inline object fields, e.g. `address: { city: String }`)
 * are represented as a single column of type 'Object' (json). We do NOT recurse
 * into separate tables for nested subdocuments in v1. Arrays of primitives are
 * likewise collapsed to an 'Array' column. Only arrays of `{ type: ObjectId,
 * ref }` are treated specially (many-to-many relation).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";
import type {
  ArrayLiteralExpression,
  NewExpression,
  ObjectLiteralExpression,
  SourceFile,
} from "ts-morph";

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

// ---------------------------------------------------------------------------
// Internal representation collected while walking the AST
// ---------------------------------------------------------------------------

interface ParsedField {
  name: string;
  /** Mongoose type name as written in source, e.g. "String", "Number",
   *  "ObjectId". "Object" for inline subdocuments, "Array" for arrays of
   *  primitives, "Mixed"/"Unknown" fallbacks. */
  type: string;
  required: boolean;
  unique: boolean;
  default: string | null;
  enumValues: string[] | null;
  /** ref target model name, when this field is an ObjectId ref. */
  ref: string | null;
  /** true when the field was declared as an array (`[...]`). */
  isArray: boolean;
}

interface ParsedSchema {
  /** variable name the schema was assigned to, when discoverable. */
  varName: string | null;
  fields: ParsedField[];
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

/** Map a Mongoose constructor/type expression text to an IR column type. */
function mapMongooseType(typeText: string): string {
  // Normalise things like "Schema.Types.ObjectId" / "mongoose.Schema.Types.ObjectId"
  // / "Types.ObjectId" -> "ObjectId".
  const t = typeText.trim();
  if (/ObjectId$/.test(t)) return "ObjectId";
  if (/(^|\.)Mixed$/.test(t) || /Schema\.Types\.Mixed$/.test(t)) return "Mixed";
  if (/(^|\.)Decimal128$/.test(t)) return "Decimal128";
  // Bare known constructors.
  switch (t) {
    case "String":
      return "String";
    case "Number":
      return "Number";
    case "Boolean":
      return "Boolean";
    case "Date":
      return "Date";
    case "Buffer":
      return "Buffer";
    case "Map":
      return "Map";
    default:
      // Fallback: last identifier segment (e.g. "foo.Bar" -> "Bar").
      const seg = t.split(".").pop() ?? t;
      return seg || "Unknown";
  }
}

// ---------------------------------------------------------------------------
// Value extraction helpers
// ---------------------------------------------------------------------------

/** Return a stable string form of a literal-ish expression, or null. */
function literalToString(node: Node | undefined): string | null {
  if (!node) return null;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isNumericLiteral(node)) return node.getText();
  if (node.getKind() === SyntaxKind.TrueKeyword) return "true";
  if (node.getKind() === SyntaxKind.FalseKeyword) return "false";
  if (node.getKind() === SyntaxKind.NullKeyword) return "null";
  // Arrays, objects, function defaults, identifiers: keep source text so callers
  // at least have a faithful representation.
  return node.getText();
}

/** Truthy-ish boolean read: `true` literal => true, everything else => false. */
function readBool(node: Node | undefined): boolean {
  if (!node) return false;
  return node.getKind() === SyntaxKind.TrueKeyword;
}

/** Read `['a','b']` array of string literals; non-strings are stringified. */
function readStringArray(node: Node | undefined): string[] {
  if (!node || !Node.isArrayLiteralExpression(node)) return [];
  const out: string[] = [];
  for (const el of node.getElements()) {
    const v = literalToString(el);
    if (v !== null) out.push(v);
  }
  return out;
}

/** Extract the ObjectLiteral describing the type options, e.g. the `{...}` in
 *  `field: { type: X, required: true }`. Returns null for shorthand form. */
function asOptionsObject(node: Node): ObjectLiteralExpression | null {
  if (Node.isObjectLiteralExpression(node)) {
    // Only treat it as an options object if it has a `type` property; otherwise
    // it's an inline subdocument.
    const typeProp = node.getProperty("type");
    if (typeProp) return node;
  }
  return null;
}

/** Get the initializer expression of a property assignment or shorthand. */
function propValue(objLit: ObjectLiteralExpression, name: string): Node | undefined {
  const prop = objLit.getProperty(name);
  if (!prop) return undefined;
  if (Node.isPropertyAssignment(prop)) return prop.getInitializerOrThrow();
  return undefined;
}

// ---------------------------------------------------------------------------
// Field parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single field value expression (the RHS of `fieldName: <expr>`), which
 * may be:
 *   - a bare constructor:            `String`, `mongoose.Schema.Types.ObjectId`
 *   - an options object:             `{ type: X, required, unique, default, enum, ref }`
 *   - an array:                      `[String]`, `[{ type: ObjectId, ref: 'X' }]`
 *   - an inline subdocument object:  `{ city: String }`  (no `type` key)
 */
function parseFieldValue(name: string, valueNode: Node): ParsedField {
  const field: ParsedField = {
    name,
    type: "Unknown",
    required: false,
    unique: false,
    default: null,
    enumValues: null,
    ref: null,
    isArray: false,
  };

  // Array form: `[X]` or `[{ type: ObjectId, ref }]`.
  if (Node.isArrayLiteralExpression(valueNode)) {
    field.isArray = true;
    const arr = valueNode as ArrayLiteralExpression;
    const first = arr.getElements()[0];
    if (!first) {
      field.type = "Array";
      return field;
    }
    // Recurse on the element; carry over its details but mark as array.
    const inner = parseFieldValue(name, first);
    field.type = inner.type;
    field.ref = inner.ref;
    field.enumValues = inner.enumValues;
    // required/unique/default on the array wrapper itself are uncommon; ignore.
    if (!field.ref) field.type = inner.type === "Object" ? "Object" : "Array";
    return field;
  }

  // Options-object form: `{ type: X, ... }`.
  const opts = Node.isObjectLiteralExpression(valueNode) ? asOptionsObject(valueNode) : null;
  if (opts) {
    const typeExpr = propValue(opts, "type");
    if (typeExpr) field.type = mapMongooseType(typeExpr.getText());
    field.required = readBool(propValue(opts, "required"));
    field.unique = readBool(propValue(opts, "unique"));
    field.default = literalToString(propValue(opts, "default"));
    const enumNode = propValue(opts, "enum");
    if (enumNode) {
      const vals = readStringArray(enumNode);
      if (vals.length) field.enumValues = vals;
    }
    const refNode = propValue(opts, "ref");
    if (refNode) field.ref = literalToString(refNode);
    return field;
  }

  // Inline subdocument: object literal WITHOUT a `type` key -> json blob.
  if (Node.isObjectLiteralExpression(valueNode)) {
    field.type = "Object";
    return field;
  }

  // Bare constructor / identifier / property-access form.
  field.type = mapMongooseType(valueNode.getText());
  return field;
}

/** Parse the top-level schema definition object literal into fields. */
function parseSchemaObject(objLit: ObjectLiteralExpression): ParsedField[] {
  const fields: ParsedField[] = [];
  for (const prop of objLit.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue; // skip spreads/methods/etc.
    const nameNode = prop.getNameNode();
    let fieldName: string;
    if (Node.isStringLiteral(nameNode)) fieldName = nameNode.getLiteralText();
    else fieldName = prop.getName();
    // Skip Mongoose reserved options if someone put them at the root (rare).
    const value = prop.getInitializerOrThrow();
    fields.push(parseFieldValue(fieldName, value));
  }
  return fields;
}

// ---------------------------------------------------------------------------
// AST discovery
// ---------------------------------------------------------------------------

/** True when a NewExpression is `new Schema(...)` or `new mongoose.Schema(...)`. */
function isSchemaNewExpression(expr: NewExpression): boolean {
  const callee = expr.getExpression().getText();
  return (
    callee === "Schema" || /(^|\.)Schema$/.test(callee) // mongoose.Schema, MG.Schema, etc.
  );
}

/** Find the variable name a NewExpression is assigned to, walking up the AST. */
function findAssignedVarName(expr: Node): string | null {
  let cur: Node | undefined = expr.getParent();
  while (cur) {
    if (Node.isVariableDeclaration(cur)) return cur.getName();
    if (Node.isPropertyAssignment(cur)) return cur.getName();
    // Stop climbing once we exit an expression/statement boundary sensibly.
    if (Node.isExpressionStatement(cur)) return null;
    cur = cur.getParent();
  }
  return null;
}

/** Collect all `new Schema(...)` schemas in a source file, keyed by var name. */
function collectSchemas(sf: SourceFile): ParsedSchema[] {
  const schemas: ParsedSchema[] = [];
  for (const expr of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (!isSchemaNewExpression(expr)) continue;
    const args = expr.getArguments();
    const first = args[0];
    if (!first || !Node.isObjectLiteralExpression(first)) {
      // `new Schema()` with no/odd args -> empty schema, still record it.
      schemas.push({ varName: findAssignedVarName(expr), fields: [] });
      continue;
    }
    schemas.push({
      varName: findAssignedVarName(expr),
      fields: parseSchemaObject(first),
    });
  }
  return schemas;
}

interface ModelDecl {
  modelName: string;
  schemaVar: string | null;
}

/** Collect `mongoose.model('Name', schemaVar)` / `model('Name', schemaVar)`. */
function collectModels(sf: SourceFile): ModelDecl[] {
  const models: ModelDecl[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    const isModelCall = calleeText === "model" || /(^|\.)model$/.test(calleeText);
    if (!isModelCall) continue;
    const args = call.getArguments();
    const nameArg = args[0];
    if (!nameArg) continue;
    const modelName = literalToString(nameArg);
    if (modelName === null) continue;
    const schemaArg = args[1];
    let schemaVar: string | null = null;
    if (schemaArg && Node.isIdentifier(schemaArg)) schemaVar = schemaArg.getText();
    models.push({ modelName, schemaVar });
  }
  return models;
}

// ---------------------------------------------------------------------------
// IR assembly
// ---------------------------------------------------------------------------

function pascalOrRaw(name: string): string {
  return name;
}

/** Build one Table (+ contributed enums/relations) from a named schema. */
function buildTable(
  tableName: string,
  schema: ParsedSchema,
  enums: Enum[],
  relations: Relation[],
): Table {
  const columns: Column[] = [];

  // Implicit Mongo `_id` primary key on every model.
  columns.push({
    name: "_id",
    type: "ObjectId",
    nullable: false,
    isPrimaryKey: true,
    isUnique: true,
    default: null,
    comment: "Implicit MongoDB primary key",
  });

  for (const f of schema.fields) {
    // Relation via ref.
    if (f.ref) {
      const relName = `${tableName}_${f.name}`;
      if (f.isArray) {
        // Array of refs -> many-to-many, empty columns per contract.
        relations.push({
          name: relName,
          fromTable: tableName,
          fromColumns: [],
          toTable: f.ref,
          toColumns: [],
          cardinality: "many-to-many",
        });
      } else {
        relations.push({
          name: relName,
          fromTable: tableName,
          fromColumns: [f.name],
          toTable: f.ref,
          toColumns: ["_id"],
          cardinality: "one-to-many",
        });
      }
    }

    // Enum on a String field -> named enum + column type = enum name.
    let colType = f.type;
    if (f.enumValues && f.enumValues.length && f.type === "String") {
      const enumName = `${tableName}_${f.name}`;
      if (!enums.some((e) => e.name === enumName)) {
        enums.push({ name: enumName, values: f.enumValues });
      }
      colType = enumName;
    }

    // Column type for array-of-ref stays as the ref target's ObjectId? We store
    // the underlying type; the relation captures cardinality. Arrays of refs are
    // represented as an ObjectId column (still nullable) so the column exists.
    if (f.isArray && f.ref) colType = "ObjectId";

    columns.push({
      name: f.name,
      type: colType,
      nullable: !f.required,
      isPrimaryKey: false,
      isUnique: f.unique,
      default: f.default,
      comment: null,
    });
  }

  return {
    name: pascalOrRaw(tableName),
    columns,
    comment: null,
  };
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

const SOURCE_GLOBS = ["**/*.ts", "**/*.js", "**/*.mts", "**/*.cts", "**/*.mjs", "**/*.cjs"];

const IGNORE_GLOBS = ["!**/node_modules/**", "!**/dist/**", "!**/build/**"];

function makeProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true },
  });
}

// ---------------------------------------------------------------------------
// detect()
// ---------------------------------------------------------------------------

async function detect(projectPath: string): Promise<boolean> {
  // 1) mongoose dependency in package.json.
  try {
    const pkgPath = join(projectPath, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<
        string,
        Record<string, string> | undefined
      >;
      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.peerDependencies ?? {}),
      };
      if (deps["mongoose"]) return true;
    }
  } catch {
    // ignore malformed package.json
  }

  // 2) Any source file containing `new mongoose.Schema(` or `new Schema(`.
  //    3) Common model files.
  const project = makeProject();
  try {
    project.addSourceFilesAtPaths([
      ...SOURCE_GLOBS.map((g) => join(projectPath, g)),
      ...IGNORE_GLOBS.map((g) => `!${join(projectPath, g.slice(1))}`),
    ]);
  } catch {
    // fall through with whatever loaded
  }

  for (const sf of project.getSourceFiles()) {
    const text = sf.getFullText();
    if (text.includes("new mongoose.Schema(") || /\bnew\s+Schema\s*\(/.test(text)) {
      return true;
    }
    const fp = sf.getFilePath().replace(/\\/g, "/");
    if (/\/(src\/)?models\/[^/]+\.(ts|js|mts|cts|mjs|cjs)$/.test(fp)) {
      // A models/* file that at least imports mongoose is a strong signal.
      if (/mongoose/.test(text)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

async function parse(input: ParserInput): Promise<IRSchema> {
  const project = makeProject();

  if (input.files && input.files.length) {
    for (const f of input.files) {
      const abs = f.startsWith("/") ? f : join(input.projectPath, f);
      if (existsSync(abs)) project.addSourceFileAtPath(abs);
    }
  } else {
    try {
      project.addSourceFilesAtPaths([
        ...SOURCE_GLOBS.map((g) => join(input.projectPath, g)),
        ...IGNORE_GLOBS.map((g) => `!${join(input.projectPath, g.slice(1))}`),
      ]);
    } catch {
      // ignore, may still have some files
    }
  }

  // Collect schemas & models across all files.
  const schemasByVar = new Map<string, ParsedSchema>();
  const anonymousSchemas: ParsedSchema[] = [];
  const models: ModelDecl[] = [];

  for (const sf of project.getSourceFiles()) {
    for (const s of collectSchemas(sf)) {
      if (s.varName) schemasByVar.set(s.varName, s);
      else anonymousSchemas.push(s);
    }
    for (const m of collectModels(sf)) models.push(m);
  }

  const enums: Enum[] = [];
  const relations: Relation[] = [];
  const tables: Table[] = [];
  const usedSchemaVars = new Set<string>();

  // 1) Tables named after models (preferred).
  for (const m of models) {
    let schema: ParsedSchema | undefined;
    if (m.schemaVar && schemasByVar.has(m.schemaVar)) {
      schema = schemasByVar.get(m.schemaVar);
      usedSchemaVars.add(m.schemaVar);
    }
    // If no linked schema found, still emit a table (with only _id) so the model
    // is represented.
    const eff: ParsedSchema = schema ?? { varName: m.schemaVar, fields: [] };
    tables.push(buildTable(m.modelName, eff, enums, relations));
  }

  // 2) Fallback: schemas that were never linked to a model -> name by var name.
  for (const [varName, schema] of schemasByVar) {
    if (usedSchemaVars.has(varName)) continue;
    // Derive a friendly table name: strip a trailing "Schema" suffix if present.
    const derived = varName.replace(/Schema$/i, "") || varName;
    const tableName = derived.charAt(0).toUpperCase() + derived.slice(1);
    tables.push(buildTable(tableName, schema, enums, relations));
  }

  const ir: IRSchema = {
    version: IR_VERSION,
    tables,
    enums,
    relations,
  };

  // Validate against the core schema contract before returning.
  return parseSchema(ir);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const mongooseParser: SchemaParser = {
  name: "mongoose",
  detect,
  parse,
};

export default mongooseParser;
