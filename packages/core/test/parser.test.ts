import { describe, expect, it } from "vitest";
import { emptySchema, normalizeParserOutput } from "../src/index";
import type { ParserResult } from "../src/index";

describe("normalizeParserOutput", () => {
  it("wraps a bare IRSchema with an empty warnings list", () => {
    const schema = emptySchema();
    const result = normalizeParserOutput(schema);
    expect(result.schema).toBe(schema);
    expect(result.warnings).toEqual([]);
  });

  it("passes a { schema, warnings } result through unchanged", () => {
    const schema = emptySchema();
    const input = { schema, warnings: ["relation skipped"] };
    const result = normalizeParserOutput(input);
    expect(result).toBe(input);
    expect(result.warnings).toEqual(["relation skipped"]);
  });

  it("fills in warnings when a result omits them", () => {
    const schema = emptySchema();
    const result = normalizeParserOutput({ schema } as unknown as ParserResult);
    expect(result.schema).toBe(schema);
    expect(result.warnings).toEqual([]);
  });

  it("keeps an empty warnings list as-is", () => {
    const input = { schema: emptySchema(), warnings: [] };
    expect(normalizeParserOutput(input).warnings).toEqual([]);
  });
});
