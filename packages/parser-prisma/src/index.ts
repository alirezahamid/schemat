import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
// @prisma/internals is CommonJS: it has no named ESM exports. Depending on the
// bundler/runtime interop, getDMMF is exposed either directly on the namespace
// or under `.default`. Resolve both shapes robustly.
import * as prismaInternals from "@prisma/internals";
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
import { IR_VERSION, parseSchema } from "@schemat/core";

type GetDMMF = (opts: { datamodel: string }) => Promise<{
  datamodel: { models: unknown[]; enums: unknown[] };
}>;

const ns = prismaInternals as unknown as {
  getDMMF?: GetDMMF;
  default?: { getDMMF?: GetDMMF };
};
const getDMMF: GetDMMF =
  ns.getDMMF ??
  ns.default?.getDMMF ??
  (() => {
    throw new Error("Could not resolve getDMMF from @prisma/internals");
  });

/** Minimal shape of the DMMF fields we consume, to avoid a hard type dep. */
interface DmmfField {
  name: string;
  kind: "scalar" | "object" | "enum" | "unsupported";
  type: string;
  isId: boolean;
  isRequired: boolean;
  isUnique: boolean;
  isList: boolean;
  hasDefaultValue: boolean;
  default?: unknown;
  relationName?: string;
  relationFromFields?: string[];
  relationToFields?: string[];
  documentation?: string;
}

interface DmmfModel {
  name: string;
  documentation?: string;
  fields: DmmfField[];
  /** Composite primary key `@@id([...])`, if any. */
  primaryKey?: { fields: string[] } | null;
  /** Composite unique constraints `@@unique([...])`. */
  uniqueFields?: string[][];
}

interface DmmfEnum {
  name: string;
  values: { name: string }[];
}

/** Render a DMMF default value into a stable display string, or null. */
function renderDefault(field: DmmfField): string | null {
  if (!field.hasDefaultValue) return null;
  const d = field.default;
  if (d === null || d === undefined) return null;
  if (typeof d === "object" && d !== null && "name" in d) {
    const fn = d as { name: string; args?: unknown[] };
    return `${fn.name}()`;
  }
  return String(d);
}

/** Map a scalar/enum field to an IR column. Returns null for relation fields. */
function toColumn(field: DmmfField): Column | null {
  if (field.kind === "object") return null;
  return {
    name: field.name,
    type: field.type,
    nullable: !field.isRequired,
    isPrimaryKey: field.isId,
    isUnique: field.isUnique || field.isId,
    default: renderDefault(field),
    comment: field.documentation ?? null,
  };
}

function toTable(model: DmmfModel): Table {
  const columns = model.fields.map((f) => toColumn(f)).filter((c): c is Column => c !== null);
  return { name: model.name, columns, comment: model.documentation ?? null };
}

function toEnum(e: DmmfEnum): Enum {
  return { name: e.name, values: e.values.map((v) => v.name) };
}

/**
 * Derive relations from DMMF. Prisma emits a relation field on BOTH sides; only
 * the side carrying `relationFromFields` owns the foreign key. Implicit
 * many-to-many relations have list fields on both sides with no scalar FK.
 */
function extractRelations(models: DmmfModel[]): Relation[] {
  const relations: Relation[] = [];

  // First pass: collect the relationNames that are backed by a real FK (the
  // owning side of a 1:1 or 1:N). Their back-reference list field must not be
  // mistaken for an implicit many-to-many.
  const fkBackedRelationNames = new Set<string>();
  for (const model of models) {
    for (const field of model.fields) {
      if (field.kind !== "object") continue;
      const from = field.relationFromFields ?? [];
      if (from.length > 0 && field.relationName) {
        fkBackedRelationNames.add(field.relationName);
      }
    }
  }

  const seenM2M = new Set<string>();

  for (const model of models) {
    for (const field of model.fields) {
      if (field.kind !== "object") continue;
      const from = field.relationFromFields ?? [];
      const to = field.relationToFields ?? [];

      // Owning side of a 1:1 / 1:N relation.
      if (from.length > 0 && to.length > 0) {
        relations.push({
          name: `${model.name}_${from.join("_")}_fkey`,
          fromTable: model.name,
          fromColumns: from,
          toTable: field.type,
          toColumns: to,
          cardinality: "one-to-many",
        });
        continue;
      }

      // Implicit many-to-many: list field on both sides, no scalar FK, and NOT
      // the back-reference of an FK-backed 1:N relation. Deduplicate by the
      // shared relationName so we emit the edge once.
      if (
        field.isList &&
        from.length === 0 &&
        field.relationName &&
        !fkBackedRelationNames.has(field.relationName)
      ) {
        if (seenM2M.has(field.relationName)) continue;
        seenM2M.add(field.relationName);
        relations.push({
          name: field.relationName,
          fromTable: model.name,
          fromColumns: [],
          toTable: field.type,
          toColumns: [],
          cardinality: "many-to-many",
        });
      }
    }
  }
  return relations;
}

/**
 * Refine 1:1 vs 1:N. A relation is one-to-one when the owning-side FK columns
 * are guaranteed unique — either each column is individually unique/PK, or the
 * FK column set exactly matches a composite unique constraint (`@@unique`) or a
 * composite primary key (`@@id`). Otherwise it is one-to-many.
 */
function refineCardinality(relations: Relation[], models: DmmfModel[]): Relation[] {
  const singleUnique = new Map<string, Set<string>>();
  const compositeUnique = new Map<string, string[][]>();
  for (const m of models) {
    const set = new Set<string>();
    for (const f of m.fields) {
      if ((f.isUnique || f.isId) && f.kind !== "object") set.add(f.name);
    }
    singleUnique.set(m.name, set);

    const composites: string[][] = [...(m.uniqueFields ?? [])];
    if (m.primaryKey?.fields?.length) composites.push(m.primaryKey.fields);
    compositeUnique.set(m.name, composites);
  }

  const sameSet = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));

  return relations.map((r): Relation => {
    if (r.cardinality === "many-to-many" || r.fromColumns.length === 0) return r;
    const singles = singleUnique.get(r.fromTable);
    const allSinglesUnique = singles !== undefined && r.fromColumns.every((c) => singles.has(c));
    const matchesComposite = (compositeUnique.get(r.fromTable) ?? []).some((set) =>
      sameSet(set, r.fromColumns),
    );
    const isOneToOne = allSinglesUnique || matchesComposite;
    return { ...r, cardinality: isOneToOne ? "one-to-one" : "one-to-many" };
  });
}

/**
 * Prisma's `getDMMF` runs full schema validation, which requires every
 * `datasource` block to have a `url`. Schemat never connects to the database —
 * it only reads the model structure — but real schemas often omit a static
 * `url` (it's supplied at runtime, via a newer generator, or the env var simply
 * isn't set at doc-generation time). Inject a harmless placeholder `url` into
 * any datasource block that lacks one so validation passes. This value is never
 * used for anything.
 */
function ensureDatasourceUrl(schema: string): string {
  return schema.replace(/datasource\s+\w+\s*\{([^}]*)\}/g, (block, body: string) => {
    // Already has a url (or directUrl-only won't satisfy Prisma, so key on url).
    if (/\burl\s*=/.test(body)) return block;
    // Insert a placeholder url right after the opening brace.
    return block.replace(/\{/, '{\n  url = "postgresql://schemat:schemat@localhost:5432/schemat"');
  });
}

/**
 * Read the project's Prisma schema. Supports both layouts:
 *  - single file: `<root>/prisma/schema.prisma`
 *  - multi-file folder (`prismaSchemaFolder`, GA since Prisma 6):
 *    `<root>/prisma/schema/*.prisma` — all files are concatenated.
 * An explicit `files` override (used by `schemat diff <file>`) wins.
 */
async function loadDatamodel(input: ParserInput): Promise<string> {
  if (input.files?.length) {
    const parts = await Promise.all(input.files.map((f) => readFile(f, "utf8")));
    return ensureDatasourceUrl(parts.join("\n\n"));
  }

  const prismaDir = path.join(input.projectPath, "prisma");
  const singleFile = path.join(prismaDir, "schema.prisma");
  const schemaFolder = path.join(prismaDir, "schema");

  // Prefer the multi-file folder when present (a repo can technically have both;
  // the folder is the modern layout and, when it exists, is the source of truth).
  const folderFiles = await readPrismaFolder(schemaFolder);
  if (folderFiles.length > 0) {
    const parts = await Promise.all(folderFiles.map((f) => readFile(f, "utf8")));
    return ensureDatasourceUrl(parts.join("\n\n"));
  }

  return ensureDatasourceUrl(await readFile(singleFile, "utf8"));
}

/** List `*.prisma` files in a schema folder (sorted for deterministic output), or [] if absent. */
async function readPrismaFolder(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".prisma"))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** Parse a Prisma schema into the canonical Schemat IR. */
async function parse(input: ParserInput): Promise<IRSchema> {
  const datamodel = await loadDatamodel(input);
  const dmmf = await getDMMF({ datamodel });
  const models = dmmf.datamodel.models as unknown as DmmfModel[];
  const enums = dmmf.datamodel.enums as unknown as DmmfEnum[];

  const schema: IRSchema = {
    version: IR_VERSION,
    tables: models.map(toTable),
    enums: enums.map(toEnum),
    relations: refineCardinality(extractRelations(models), models),
  };

  // Validate against the canonical IR before handing it off.
  return parseSchema(schema);
}

async function detect(projectPath: string): Promise<boolean> {
  // Single-file layout: <root>/prisma/schema.prisma
  const singleFile = path.join(projectPath, "prisma", "schema.prisma");
  try {
    await readFile(singleFile, "utf8");
    return true;
  } catch {
    // fall through to the multi-file folder check
  }
  // Multi-file layout: <root>/prisma/schema/*.prisma
  const folderFiles = await readPrismaFolder(path.join(projectPath, "prisma", "schema"));
  return folderFiles.length > 0;
}

export const prismaParser: SchemaParser = {
  name: "prisma",
  detect,
  parse,
};

export default prismaParser;
