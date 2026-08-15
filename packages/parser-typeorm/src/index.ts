import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { IR_VERSION, mapToCanonicalType, parseSchema } from "@schemat/core";
import type {
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
import { Project, SyntaxKind } from "ts-morph";
import type {
  ClassDeclaration,
  Decorator,
  ObjectLiteralExpression,
  PropertyDeclaration,
} from "ts-morph";

// ---------------------------------------------------------------------------
// Decorator name sets
// ---------------------------------------------------------------------------

const COLUMN_DECORATORS = new Set([
  "Column",
  "PrimaryColumn",
  "PrimaryGeneratedColumn",
  "CreateDateColumn",
  "UpdateDateColumn",
  "DeleteDateColumn",
  "VersionColumn",
  "ObjectIdColumn",
]);

const PRIMARY_DECORATORS = new Set(["PrimaryColumn", "PrimaryGeneratedColumn"]);

const RELATION_DECORATORS = new Set(["OneToOne", "OneToMany", "ManyToOne", "ManyToMany"]);

// Default column type when a decorator carries no explicit `type`.
// Kept intentionally generic; a real core would map TS types more richly.
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

function fileHasEntityDecorator(path: string): boolean {
  try {
    return /@Entity\s*\(/.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Decorators that only TypeORM defines. Used as a fallback signal when a
 * NestJS-style project re-exports TypeORM's decorators through a shared barrel
 * (`import { Entity, Column } from "@app/common/database"`), so the entity file
 * never mentions `typeorm` by name.
 */
const TYPEORM_ONLY_DECORATORS =
  /@(PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|VersionColumn|JoinColumn|JoinTable|ObjectIdColumn)\s*\(/;

/** Walk up from `dir` looking for a package.json that declares `typeorm`. */
function ancestorDeclaresTypeorm(dir: string, maxLevels = 5): boolean {
  let current = dir;
  for (let i = 0; i < maxLevels; i++) {
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
    if (packageDeclaresTypeorm(join(current, "package.json"))) return true;
  }
  return false;
}

/** True when the package.json at `pkgPath` lists `typeorm` in any deps field. */
function packageDeclaresTypeorm(pkgPath: string): boolean {
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
      if (deps && Object.prototype.hasOwnProperty.call(deps, "typeorm")) return true;
    }
  } catch {
    // ignore malformed package.json
  }
  return false;
}

// ---------------------------------------------------------------------------
// detect()
// ---------------------------------------------------------------------------

async function detect(projectPath: string): Promise<boolean> {
  // 1. typeorm dependency in package.json
  if (packageDeclaresTypeorm(join(projectPath, "package.json"))) return true;

  // 2. Decorator-based detection. Require a TypeORM signal in the same file as
  //    an @Entity( decorator, so we don't false-positive MikroORM (which also
  //    uses @Entity but imports from @mikro-orm/core).
  const tsFiles = walkTsFiles(projectPath);
  for (const f of tsFiles) {
    if (fileIsTypeormEntity(f)) return true;
  }

  // 3. Workspace fallback: in a monorepo `typeorm` is often hoisted to the root
  //    package.json, so a service's own package.json never mentions it. Accept
  //    that only alongside a real entity file here, so schema-less packages in
  //    the same workspace don't all claim to be TypeORM projects.
  //    The same @mikro-orm/ exclusion as rung 2 applies: MikroORM also uses
  //    @Entity, and this parser precedes the MikroORM one, so without the guard
  //    a MikroORM service in a typeorm-declaring workspace gets claimed here and
  //    emits class-name tables with zero columns.
  if (tsFiles.some(fileHasNonMikroEntityDecorator) && ancestorDeclaresTypeorm(projectPath)) {
    return true;
  }

  return false;
}

/** @Entity decorator in a file that is not a MikroORM entity. */
function fileHasNonMikroEntityDecorator(path: string): boolean {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  if (!/@Entity\s*\(/.test(text)) return false;
  return !/from\s+['"]@mikro-orm\//.test(text);
}

/**
 * True when a file has an @Entity decorator and a TypeORM signal: either a
 * direct `typeorm` import, or a TypeORM-only decorator (covers barrel
 * re-exports) while not importing @mikro-orm/core.
 */
function fileIsTypeormEntity(path: string): boolean {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  if (!/@Entity\s*\(/.test(text)) return false;
  if (/from\s+['"]typeorm['"]/.test(text)) return true;
  // MikroORM also uses @Entity — never claim its files.
  if (/from\s+['"]@mikro-orm\//.test(text)) return false;
  return TYPEORM_ONLY_DECORATORS.test(text);
}

// ---------------------------------------------------------------------------
// Decorator option helpers
// ---------------------------------------------------------------------------

/** Return the ObjectLiteralExpression options arg of a decorator, if present. */
function getOptionsObject(dec: Decorator): ObjectLiteralExpression | undefined {
  const args = dec.getArguments();
  for (const arg of args) {
    if (arg.getKind() === SyntaxKind.ObjectLiteralExpression) {
      return arg as ObjectLiteralExpression;
    }
  }
  return undefined;
}

/** Return the first string-literal argument of a decorator, if present. */
function getFirstStringArg(dec: Decorator): string | undefined {
  const args = dec.getArguments();
  for (const arg of args) {
    const strLit =
      arg.asKind(SyntaxKind.StringLiteral) ?? arg.asKind(SyntaxKind.NoSubstitutionTemplateLiteral);
    if (strLit) return strLit.getLiteralText();
  }
  return undefined;
}

/** Read a property initializer from an options object as raw text. */
function getPropText(obj: ObjectLiteralExpression | undefined, name: string): string | undefined {
  if (!obj) return undefined;
  const prop = obj.getProperty(name);
  if (!prop) return undefined;
  if (prop.getKind() !== SyntaxKind.PropertyAssignment) return undefined;
  const init = (prop as import("ts-morph").PropertyAssignment).getInitializer();
  return init?.getText();
}

function getPropBool(obj: ObjectLiteralExpression | undefined, name: string): boolean | undefined {
  const t = getPropText(obj, name);
  if (t === "true") return true;
  if (t === "false") return false;
  return undefined;
}

/** Strip surrounding quotes from a string-literal text form. */
function unquote(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const m = text.match(/^(['"`])([\s\S]*)\1$/);
  return m ? m[2] : text;
}

// ---------------------------------------------------------------------------
// Column extraction
// ---------------------------------------------------------------------------

interface ExtractedColumn {
  column: Column;
  /** enum captured from `type:'enum'` columns, if any */
  enum?: Enum;
}

function extractColumn(
  prop: PropertyDeclaration,
  colDec: Decorator,
  entityName: string,
  enumValues: Map<string, string[]>,
): ExtractedColumn {
  const decName = colDec.getName();
  const opts = getOptionsObject(colDec);

  // Column name in TypeORM is NEVER a positional decorator arg — it is only
  // `options.name`, otherwise the property name. (A positional string is the
  // column *type* for @Column, or the *strategy* for @PrimaryGeneratedColumn.)
  const optName = unquote(getPropText(opts, "name"));
  const name = optName ?? prop.getName();

  const isPrimaryKey = PRIMARY_DECORATORS.has(decName);

  // nullable / unique — decorator wins; otherwise TS `prop?:` means nullable.
  const nullable = getPropBool(opts, "nullable") ?? prop.hasQuestionToken();
  const unique = getPropBool(opts, "unique") ?? false;

  // default -> canonical string form or null
  const defaultText = getPropText(opts, "default");
  const defaultVal = defaultText === undefined ? null : (unquote(defaultText) ?? defaultText);

  // ---- type resolution -------------------------------------------------
  let type: string;
  let capturedEnum: Enum | undefined;

  // options.type wins; else a positional string type e.g. @Column('varchar').
  const positionalStr = getFirstStringArg(colDec);
  const declaredType =
    unquote(getPropText(opts, "type")) ??
    (decName === "Column" || decName === "PrimaryColumn" ? positionalStr : undefined);

  if (declaredType === "enum") {
    // enum: SomeEnum  OR  enum: ['a','b']
    const enumProp = opts?.getProperty("enum");
    const { enumName, values } = resolveEnum(opts, enumProp, entityName, name);
    type = "enum"; // closed canonical; rawType below stores enumName
    // Prefer inline array values; otherwise look up a resolved enum decl.
    const resolved = values ?? enumValues.get(enumName);
    capturedEnum = { name: enumName, values: resolved ?? [] };
    // Stash enum name for rawType via capturedEnum.name
  } else if (declaredType) {
    type = declaredType;
  } else if (decName === "PrimaryGeneratedColumn") {
    // positional strategy: 'uuid' -> uuid, else numeric autoincrement
    type = positionalStr === "uuid" ? "uuid" : "number";
  } else if (
    decName === "CreateDateColumn" ||
    decName === "UpdateDateColumn" ||
    decName === "DeleteDateColumn"
  ) {
    type = "timestamp";
  } else if (decName === "VersionColumn") {
    type = "number";
  } else {
    // fall back to the property's TS type text
    type = tsTypeToColumnType(prop);
  }

  const rawType = capturedEnum?.name ?? type;
  return {
    column: {
      name,
      type: capturedEnum ? ("enum" as const) : mapToCanonicalType(type),
      rawType,
      nullable,
      isPrimaryKey,
      isUnique: unique,
      isList: false,
      default: defaultVal,
      comment: unquote(getPropText(opts, "comment")) ?? null,
    },
    enum: capturedEnum,
  };
}

function resolveEnum(
  opts: ObjectLiteralExpression | undefined,
  enumProp: import("ts-morph").ObjectLiteralElementLike | undefined,
  entityName: string,
  columnName: string,
): { enumName: string; values?: string[] } {
  if (!enumProp || enumProp.getKind() !== SyntaxKind.PropertyAssignment) {
    return { enumName: `${entityName}_${columnName}_enum` };
  }
  const init = (enumProp as import("ts-morph").PropertyAssignment).getInitializer();
  if (!init) return { enumName: `${entityName}_${columnName}_enum` };

  if (init.getKind() === SyntaxKind.ArrayLiteralExpression) {
    const arr = init as import("ts-morph").ArrayLiteralExpression;
    const values = arr.getElements().map((el) => {
      const t = el.getText();
      return unquote(t) ?? t;
    });
    // synthesize a deterministic name; enum-from-array has no identifier
    const enumName = `${entityName}_${columnName}_enum`;
    return { enumName, values };
  }

  // enum: SomeEnum  -> identifier reference; use its name, no inline values
  // (static parsing can't always resolve external enum members reliably)
  const refName = init.getText();
  return { enumName: refName };
}

/**
 * Map a TS property type annotation to a known column type string.
 * Unknown / complex TS text must NOT leak into IR `type`.
 */
function tsTypeToColumnType(prop: PropertyDeclaration): string {
  const tn = prop.getTypeNode();
  if (!tn) return DEFAULT_COLUMN_TYPE;
  const text = tn
    .getText()
    .replace(/\s*\|\s*null\b/g, "")
    .replace(/\s*\|\s*undefined\b/g, "")
    .trim();
  switch (text) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "Date":
      return "timestamp";
    case "string":
      return "string";
    case "bigint":
      return "bigint";
    case "Buffer":
      return "bytes";
    default:
      return DEFAULT_COLUMN_TYPE;
  }
}

// ---------------------------------------------------------------------------
// Relation extraction
// ---------------------------------------------------------------------------

interface ExtractedRelation {
  relation: Relation;
}

/** Resolve the target entity/table name from a relation decorator's type-thunk. */
function relationTargetName(dec: Decorator): string | undefined {
  const args = dec.getArguments();
  for (const arg of args) {
    // typically an ArrowFunction: () => Role
    if (arg.getKind() === SyntaxKind.ArrowFunction) {
      const body = (arg as import("ts-morph").ArrowFunction).getBody();
      // body is the referenced identifier (possibly Role or () => Role[])
      const txt = body.getText().replace(/\[\]$/, "").trim();
      // handle `type => Role` style too (already covered) and bare identifier
      return txt.replace(/[()]/g, "") || undefined;
    }
    if (arg.getKind() === SyntaxKind.Identifier) {
      return arg.getText();
    }
  }
  return undefined;
}

function hasDecorator(prop: PropertyDeclaration, name: string): boolean {
  return prop.getDecorators().some((d) => d.getName() === name);
}

/** FK column name: `@JoinColumn({ name })` when present, else `<prop>Id`. */
function joinColumnName(prop: PropertyDeclaration): string {
  const joinDec = prop.getDecorators().find((d) => d.getName() === "JoinColumn");
  if (joinDec) {
    const positional = getFirstStringArg(joinDec);
    if (positional) return positional;
    const named = unquote(getPropText(getOptionsObject(joinDec), "name"));
    if (named) return named;
  }
  return `${prop.getName()}Id`;
}

function extractRelation(
  prop: PropertyDeclaration,
  relDec: Decorator,
  thisTable: string,
): ExtractedRelation | undefined {
  const kind = relDec.getName();
  const target = relationTargetName(relDec);
  if (!target) return undefined;

  const propName = prop.getName();
  const relName = `${thisTable}_${propName}`;

  // Prefer explicit @JoinColumn name; else TypeORM default `<prop>Id`.
  const fkColumn = joinColumnName(prop);

  switch (kind) {
    case "ManyToOne": {
      // This entity owns the FK. In the IR (which has no `many-to-one`), the
      // owning-FK edge is represented as `one-to-many` from the owner side.
      return {
        relation: {
          name: relName,
          fromTable: thisTable,
          fromColumns: [fkColumn],
          toTable: target,
          toColumns: ["id"],
          cardinality: "one-to-many" as Cardinality,
        },
      };
    }
    case "OneToOne": {
      // Owner side = the one carrying @JoinColumn. If neither present,
      // we still emit this side as owner (from = thisTable).
      const owns = hasDecorator(prop, "JoinColumn");
      // If @JoinColumn is absent we still record it, but a non-owning
      // OneToOne (inverse) would normally be skipped. We keep it only when
      // it either owns the join or has no inverse-side hint.
      const inverseArg = relDec.getArguments().length >= 2;
      if (!owns && inverseArg) {
        // inverse side of a bidirectional 1:1 -> skip to avoid duplication
        return undefined;
      }
      return {
        relation: {
          name: relName,
          fromTable: thisTable,
          fromColumns: [fkColumn],
          toTable: target,
          toColumns: ["id"],
          cardinality: "one-to-one" as Cardinality,
        },
      };
    }
    case "ManyToMany": {
      // Only the @JoinTable side is the owner; emit once from owner.
      if (!hasDecorator(prop, "JoinTable")) return undefined;
      return {
        relation: {
          name: relName,
          fromTable: thisTable,
          fromColumns: [],
          toTable: target,
          toColumns: [],
          cardinality: "many-to-many" as Cardinality,
        },
      };
    }
    case "OneToMany": {
      // Inverse of a ManyToOne. Skip to avoid duplicating the FK edge —
      // the owning @ManyToOne on the other entity already produced it.
      return undefined;
    }
    default:
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
  const arg = getFirstStringArg(entityDec);
  if (arg) return arg;
  const optName = unquote(getPropText(getOptionsObject(entityDec), "name"));
  if (optName) return optName;
  return cls.getName() ?? "UnnamedEntity";
}

function entityComment(entityDec: Decorator): string | null {
  return unquote(getPropText(getOptionsObject(entityDec), "comment")) ?? null;
}

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

function collectEntityFiles(input: ParserInput): string[] {
  if (input.files && input.files.length > 0) {
    return input.files.map((f) => (f.startsWith("/") ? f : join(input.projectPath, f)));
  }
  const all = walkTsFiles(input.projectPath);
  // Prefer *.entity.ts, but include any file with an @Entity( decorator.
  return all.filter((f) => f.endsWith(".entity.ts") || fileHasEntityDecorator(f));
}

async function parse(input: ParserInput): Promise<ParserResult> {
  const files = collectEntityFiles(input);

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: false,
      // We only parse; no type-checking / emit needed.
    },
  });

  for (const f of files) {
    if (existsSync(f)) project.addSourceFileAtPath(f);
  }

  const tables: Table[] = [];
  const relations: Relation[] = [];
  const enumMap = new Map<string, Enum>();
  const warnings: string[] = [];

  // Pre-scan every source file for `enum X { ... }` declarations so that
  // `@Column({ type:'enum', enum: X })` can resolve X's members statically.
  const enumValues = new Map<string, string[]>();
  for (const sf of project.getSourceFiles()) {
    for (const ed of sf.getEnums()) {
      const name = ed.getName();
      const values = ed.getMembers().map((m) => {
        const init = m.getInitializer();
        if (init) {
          const t = init.getText();
          return unquote(t) ?? t;
        }
        return m.getName();
      });
      enumValues.set(name, values);
    }
  }

  // First pass: map entity CLASS name -> table name, so relation targets (which
  // reference the class, e.g. `() => UserEntity`) resolve to the real table name
  // (`@Entity('user')` -> `user`). Without this, edges point at a class name
  // that has no matching table and the diagram drops the relation.
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

        const colDec = decs.find((d) => COLUMN_DECORATORS.has(d.getName()));
        if (colDec) {
          const { column, enum: en } = extractColumn(prop, colDec, tableName, enumValues);
          columns.push(column);
          if (en && !enumMap.has(en.name)) enumMap.set(en.name, en);
          continue;
        }

        const relDec = decs.find((d) => RELATION_DECORATORS.has(d.getName()));
        if (relDec) {
          const extracted = extractRelation(prop, relDec, tableName);
          if (extracted) {
            // Resolve the relation's target class name to its real table name.
            // Skip relations whose target isn't a known entity table — leaving a
            // raw class name would produce a dangling edge to a nonexistent
            // table (target in an unparsed file or a non-@Entity class).
            const rel = extracted.relation;
            const resolved = classToTable.get(rel.toTable);
            if (!resolved) {
              warnings.push(
                `TypeORM relation "${cls.getName() ?? tableName}.${prop.getName()}" targets unresolved entity "${rel.toTable}"; relation skipped.`,
              );
              continue;
            }
            rel.toTable = resolved;
            relations.push(rel);
          }
        }
      }

      tables.push({
        name: tableName,
        columns,
        comment: entityComment(entityDec),
      });
    }
  }

  const schema: IRSchema = {
    version: IR_VERSION,
    tables,
    enums: [...enumMap.values()],
    relations,
  };

  // Validate against the canonical core schema before returning.
  return { schema: parseSchema(schema), warnings };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const typeormParser: SchemaParser = {
  name: "typeorm",
  detect,
  parse,
  watchTargets: (projectPath) => [projectPath],
};

export default typeormParser;
