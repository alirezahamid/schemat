import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCheck } from "../src/commands/check";
import { runInit } from "../src/commands/init";
import { runSnapshot } from "../src/commands/snapshot";
import { noSchemaMessage } from "../src/schema-source";

/**
 * The regression guard for the "suggestion that doesn't run" class of bug:
 * every `schemat …` line the CLI prints must parse as a real command with real
 * options. We capture the CLI's actual output, extract every suggestion, and
 * run each one through a parser mirroring src/index.ts.
 */

/** A commander program with the same commands/options as the real CLI. */
function buildProgram(): Command {
  const program = new Command();
  program.name("schemat").exitOverride();
  const withCommon = (cmd: Command) =>
    cmd
      .exitOverride()
      .option("-r, --root <dir>", "project root", ".")
      .option("-s, --source <parser>", "source override")
      .action(() => undefined);

  withCommon(program.command("init")).option("-f, --force");
  withCommon(program.command("dev")).option("-p, --port <number>", "port", "5173");
  withCommon(program.command("export"))
    .option("-f, --format <format>", "format", "svg")
    .option("-o, --out <file>", "out file");
  withCommon(program.command("snapshot"));
  withCommon(program.command("check")).option("-f, --format <format>", "format", "text");
  program
    .command("diff")
    .exitOverride()
    .argument("<before>")
    .argument("<after>")
    .option("-f, --format <format>", "format", "text")
    .option("-s, --source <parser>", "source override")
    .action(() => undefined);
  return program;
}

/** Every `schemat …` command found in a blob of CLI output. */
function extractSuggestions(text: string): string[] {
  const found = new Set<string>();
  // Suggestions appear either on their own indented line or inside backticks.
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(/`(schemat [^`]+)`/g)) found.add(m[1].trim());
    const bare = line.match(/^\s+(schemat\s+.+?)\s*$/);
    if (bare && !line.includes("`")) found.add(bare[1].trim());
  }
  return [...found];
}

/** Split a suggestion the way a shell would (handles single-quoted args). */
function tokenize(command: string): string[] {
  return (command.match(/'[^']*'|\S+/g) ?? []).map((t) =>
    t.startsWith("'") && t.endsWith("'") ? t.slice(1, -1) : t,
  );
}

function assertRunnable(command: string): void {
  const argv = tokenize(command);
  expect(argv[0], `suggestion must start with "schemat": ${command}`).toBe("schemat");
  expect(argv.length, `suggestion must name a subcommand: ${command}`).toBeGreaterThan(1);
  expect(() => buildProgram().parse(argv.slice(1), { from: "user" })).not.toThrow();
}

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "schemat-suggest-"));
  cwd = process.cwd();
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

/** A monorepo whose sub-projects each hold a Prisma schema. */
function makeMonorepo(root: string, services: string[]): void {
  for (const svc of services) {
    const prisma = path.join(root, "apps", svc, "prisma");
    mkdirSync(prisma, { recursive: true });
    writeFileSync(path.join(prisma, "schema.prisma"), "model User {\n  id Int @id\n}\n", "utf8");
  }
}

describe("every emitted suggestion is copy-pasteable", () => {
  it("monorepo hint carries the invoked subcommand", async () => {
    makeMonorepo(dir, ["identity-service", "asset-service"]);

    for (const command of ["dev", "init", "export", "snapshot", "check"]) {
      const message = await noSchemaMessage(dir, { command, root: "." });
      const suggestions = extractSuggestions(message);
      expect(suggestions.length, `no suggestions for ${command}`).toBeGreaterThan(0);
      for (const s of suggestions) {
        assertRunnable(s);
        expect(s.startsWith(`schemat ${command} `)).toBe(true);
      }
    }
  });

  it("monorepo hint echoes back the user's --root", async () => {
    const repo = path.join(dir, "repo");
    makeMonorepo(repo, ["identity-service"]);

    const message = await noSchemaMessage(repo, { command: "dev", root: "repo" });
    for (const s of extractSuggestions(message)) assertRunnable(s);
    expect(message).toContain("schemat dev --root repo/apps/identity-service");
  });

  it("check, snapshot and init next-steps output stay runnable", async () => {
    const prisma = path.join(dir, "prisma");
    mkdirSync(prisma, { recursive: true });
    writeFileSync(path.join(prisma, "schema.prisma"), "model User {\n  id Int @id\n}\n", "utf8");

    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => lines.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args) => lines.push(args.join(" ")));
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    // check without a snapshot → "run snapshot first"
    await runCheck({ root: ".", format: "text" });
    // init → next steps
    await runInit({ root: "." });
    // snapshot → "commit this so check can detect drift"
    await runSnapshot({ root: "." });
    // Introduce drift so the markdown report emits its "regenerate it with …"
    // suggestion rather than the up-to-date message.
    writeFileSync(
      path.join(prisma, "schema.prisma"),
      "model User {\n  id Int @id\n}\n\nmodel Post {\n  id Int @id\n}\n",
      "utf8",
    );
    // check with drift in markdown → "regenerate it with …"
    await runCheck({ root: ".", format: "markdown" });

    const suggestions = extractSuggestions(lines.join("\n"));
    expect(suggestions).toEqual(
      expect.arrayContaining(["schemat snapshot", "schemat check", "schemat dev"]),
    );
    for (const s of suggestions) assertRunnable(s);
  });

  it("suggestions in a subdirectory root stay runnable and keep --root", async () => {
    const svc = path.join(dir, "apps", "api");
    mkdirSync(path.join(svc, "prisma"), { recursive: true });
    writeFileSync(
      path.join(svc, "prisma", "schema.prisma"),
      "model User {\n  id Int @id\n}\n",
      "utf8",
    );

    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => lines.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args) => lines.push(args.join(" ")));

    await runInit({ root: "apps/api" });

    const suggestions = extractSuggestions(lines.join("\n"));
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      assertRunnable(s);
      expect(s).toContain("--root apps/api");
    }
  });
});
