import type { SchemaParser } from "@schemat/core";
import { describe, expect, it } from "vitest";
import { resolveWatchTargets } from "../src/watch";

const parser = (watchTargets?: SchemaParser["watchTargets"]): SchemaParser => ({
  name: "test",
  detect: async () => true,
  parse: async () => ({ version: 1, tables: [], enums: [], relations: [] }),
  watchTargets,
});

describe("resolveWatchTargets", () => {
  it("uses multiple targets with stable deduplication", () => {
    expect(
      resolveWatchTargets(
        parser(() => ["a", "b", "a"]),
        "/project",
      ),
    ).toEqual(["a", "b"]);
  });

  it.each([
    ["legacy parser", parser()],
    ["zero targets", parser(() => [])],
    ["unusable targets", parser(() => ["", "  "])],
    [
      "throwing parser",
      parser(() => {
        throw new Error("broken");
      }),
    ],
  ])("falls back to the project root for %s", (_name, subject) => {
    expect(resolveWatchTargets(subject, "/project")).toEqual(["/project"]);
  });
});
