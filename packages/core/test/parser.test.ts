import { describe, expect, it } from "vitest";
import { emptySchema, normalizeParserOutput } from "../src/index";

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
});
