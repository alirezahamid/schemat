export {
  Cardinality,
  Column,
  Relation,
  Table,
  Enum,
  IRSchema,
  IR_VERSION,
  emptySchema,
  parseSchema,
} from "./ir";
export { normalizeParserOutput } from "./parser";
export type { SchemaParser, ParserInput, ParserOutput, ParserResult } from "./parser";
export { diff } from "./differ";
export type { SchemaChange } from "./differ";
