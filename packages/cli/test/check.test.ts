import type { IRSchema } from "@schemat/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const schema: IRSchema = {
  version: 1,
  tables: [],
  enums: [{ name: "Status", values: ["DRAFT", "ARCHIVED"] }],
  relations: [],
};

vi.mock("../src/schema-source", () => ({
  noSchemaMessage: vi.fn(),
  resolveSchemaResult: vi.fn(async () => ({
    schema,
    warnings: ['Unsupported SQL statement "CREATE INDEX users_email_idx"; statement skipped.'],
  })),
}));

const { loadSnapshotMock } = vi.hoisted(() => ({ loadSnapshotMock: vi.fn() }));
vi.mock("../src/snapshot", () => ({
  loadSnapshot: loadSnapshotMock,
  snapshotPath: vi.fn(),
}));

import { runCheck } from "../src/commands/check";

describe("runCheck", () => {
  beforeEach(() => {
    loadSnapshotMock.mockResolvedValue(schema);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("reports enum-only drift and exits 1", async () => {
    loadSnapshotMock.mockResolvedValueOnce({
      ...schema,
      enums: [{ name: "Status", values: ["DRAFT", "PUBLISHED"] }],
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runCheck({ root: ".", format: "text" });

    expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
      "~ enum    Status  (DRAFT, PUBLISHED → DRAFT, ARCHIVED)",
    );
    expect(process.exitCode).toBe(1);
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
