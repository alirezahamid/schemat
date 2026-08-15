export {
  Cardinality,
  CanonicalTypeSchema,
  Column,
  Relation,
  Table,
  Enum,
  IRSchema,
  IR_VERSION,
  emptySchema,
  parseSchema,
} from "./ir";
export type { CanonicalType } from "./ir";
export { CANONICAL_TYPES, isCanonicalType, mapToCanonicalType } from "./types";
export { normalizeParserOutput } from "./parser";
export type { SchemaParser, ParserInput, ParserOutput, ParserResult } from "./parser";
export { diff } from "./differ";
export type { SchemaChange } from "./differ";
