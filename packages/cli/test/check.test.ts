import type { IRSchema } from "@schemat/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const schema: IRSchema = { version: 1, tables: [], enums: [], relations: [] };

vi.mock("../src/schema-source", () => ({
  noSchemaMessage: vi.fn(),
  resolveSchemaResult: vi.fn(async () => ({
    schema,
    warnings: ['Unsupported SQL statement "CREATE INDEX users_email_idx"; statement skipped.'],
  })),
}));

vi.mock("../src/snapshot", () => ({
  loadSnapshot: vi.fn(async () => schema),
  snapshotPath: vi.fn(),
}));

import { runCheck } from "../src/commands/check";

describe("runCheck", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("keeps parser warnings out of markdown stdout", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runCheck({ root: ".", format: "markdown" });

    const stdoutText = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    const stderrText = stderr.mock.calls.flat().join("\n");
    expect(stdoutText).not.toContain("Unsupported SQL statement");
    expect(stdoutText).not.toContain("Parser warnings");
    expect(stderrText).toContain("Unsupported SQL statement");
  });
});
