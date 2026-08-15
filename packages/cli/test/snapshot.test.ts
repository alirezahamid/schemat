import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSnapshot, snapshotPath } from "../src/snapshot";

const dirs: string[] = [];

async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "schemat-snapshot-"));
  dirs.push(dir);
  return dir;
}

async function writeSnapshot(projectPath: string, content: string): Promise<void> {
  const target = snapshotPath(projectPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadSnapshot", () => {
  it("returns null when the snapshot is missing", async () => {
    await expect(loadSnapshot(await project())).resolves.toBeNull();
  });

  it("throws an actionable error for truncated JSON", async () => {
    const root = await project();
    await writeSnapshot(root, '{"version": 1,');

    await expect(loadSnapshot(root)).rejects.toThrow(
      `snapshot file exists but is invalid: ${snapshotPath(root)}:`,
    );
  });

  it("throws the same actionable error for valid JSON that fails schema validation", async () => {
    const root = await project();
    await writeSnapshot(root, JSON.stringify({ version: 1, tables: [] }));

    await expect(loadSnapshot(root)).rejects.toThrow(
      `snapshot file exists but is invalid: ${snapshotPath(root)}:`,
    );
  });
});
