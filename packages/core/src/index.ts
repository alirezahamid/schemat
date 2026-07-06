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
export type { SchemaParser, ParserInput } from "./parser";
export { diff } from "./differ";
export type { SchemaChange } from "./differ";
