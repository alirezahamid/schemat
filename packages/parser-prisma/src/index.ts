import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  Cardinality,
  Column,
  Enum,
  IRSchema,
  ParserInput,
  Relation,
  SchemaParser,
  Table,
} from "@alirezahamid/schemat-core";
import { IR_VERSION, parseSchema } from "@alirezahamid/schemat-core";
// @prisma/internals is CommonJS: it has no named ESM exports, so it must be
// namespace-imported and destructured. (Learned the hard way — do not
// "import { getDMMF }".)
import * as prismaInternals from "@prisma/internals";

const { getDMMF } = prismaInternals;

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
function toColumn(field: DmmfField, foreignKeyNames: Set<string>): Column | null {
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
  const fkNames = new Set<string>();
  for (const f of model.fields) {
    for (const c of f.relationFromFields ?? []) fkNames.add(c);
  }
  const columns = model.fields
    .map((f) => toColumn(f, fkNames))
    .filter((c): c is Column => c !== null);
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
 * Refine 1:1 vs 1:N. A relation whose FK column set is unique on the owning
 * table is one-to-one; otherwise one-to-many.
 */
function refineCardinality(relations: Relation[], models: DmmfModel[]): Relation[] {
  const uniqueCols = new Map<string, Set<string>>();
  for (const m of models) {
    const set = new Set<string>();
    for (const f of m.fields) {
      if ((f.isUnique || f.isId) && f.kind !== "object") set.add(f.name);
    }
    uniqueCols.set(m.name, set);
  }
  return relations.map((r): Relation => {
    if (r.cardinality === "many-to-many" || r.fromColumns.length === 0) return r;
    const uniques = uniqueCols.get(r.fromTable);
    const isOneToOne =
      uniques !== undefined && r.fromColumns.every((c) => uniques.has(c));
    return { ...r, cardinality: isOneToOne ? "one-to-one" : "one-to-many" };
  });
}

async function loadDatamodel(input: ParserInput): Promise<string> {
  const file =
    input.files?.[0] ??
    path.join(input.projectPath, "prisma", "schema.prisma");
  return readFile(file, "utf8");
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
  const candidate = path.join(projectPath, "prisma", "schema.prisma");
  try {
    await readFile(candidate, "utf8");
    return true;
  } catch {
    return false;
  }
}

export const prismaParser: SchemaParser = {
  name: "prisma",
  detect,
  parse,
};

export default prismaParser;
