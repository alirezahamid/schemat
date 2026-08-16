import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCheck } from "../src/commands/check";
import { runDev } from "../src/commands/dev";
import { runInit } from "../src/commands/init";
import { runSnapshot } from "../src/commands/snapshot";
import { createProgram } from "../src/program";
import { noSchemaMessage } from "../src/schema-source";
import { stripAnsi } from "../src/ui";

/**
 * The regression guard for the "suggestion that doesn't run" class of bug:
 * every `schemat …` line the CLI prints must parse as a real command with real
 * options. We capture the CLI's actual output, extract every suggestion, and
 * run each one through a parser mirroring src/index.ts.
 */

/**
 * The REAL command/option tree, with every action replaced by a no-op so
 * parsing a suggestion doesn't actually run a command. Importing the grammar
 * (rather than mirroring it by hand) is what stops this guard from validating
 * suggestions against a stale copy of the CLI.
 */
function buildProgram(): Command {
  const program = createProgram().exitOverride();
  for (const cmd of program.commands) {
    cmd.exitOverride().action(() => undefined);
  }
  return program;
}

/**
 * Capture everything the CLI prints, on every channel it prints through.
 *
 * The CLI writes styled output straight to the streams (it has to: the colour
 * decision is per-stream), so spying on console alone would silently stop
 * seeing most suggestions and let this guard pass while broken.
 */
function captureOutput(): { text: () => string } {
  const lines: string[] = [];
  const push = (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  };
  vi.spyOn(console, "log").mockImplementation((...args) => lines.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args) => lines.push(args.join(" ")));
  vi.spyOn(process.stdout, "write").mockImplementation(push);
  vi.spyOn(process.stderr, "write").mockImplementation(push);
  return { text: () => lines.join("\n") };
}

/** Every `schemat …` command found in a blob of CLI output. */
function extractSuggestions(raw: string): string[] {
  const found = new Set<string>();
  // Strip styling first: a suggestion is only useful if it survives being
  // copied out of coloured output, so the guard must see the same characters
  // the user's clipboard would.
  const text = stripAnsi(raw);
  // Suggestions appear either on their own indented line or inside backticks.
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(/`(schemat [^`]+)`/g)) found.add(m[1].trim());
    // A suggestion may be printed on its own line, optionally behind a list
    // marker (`• schemat …` / `- schemat …`). The marker is decoration; the
    // command after it is what the user copies.
    const bare = line.match(/^\s*(?:[•*-]\s+)?(schemat\s+.+?)\s*$/);
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
    // A non-"." root on purpose: with root ".", `suggestCommand` omits --root
    // and a hardcoded default like "schemat snapshot" looks correct by
    // accident. Everything below must carry `--root apps/api` to pass.
    const root = path.join("apps", "api");
    const prisma = path.join(dir, root, "prisma");
    mkdirSync(prisma, { recursive: true });
    writeFileSync(path.join(prisma, "schema.prisma"), "model User {\n  id Int @id\n}\n", "utf8");

    const output = captureOutput();

    // check without a snapshot → "run snapshot first"
    await runCheck({ root, format: "text" });
    // init → next steps
    await runInit({ root });
    // snapshot → "commit this so check can detect drift"
    await runSnapshot({ root });
    // Introduce drift so the markdown report emits its "regenerate it with …"
    // suggestion rather than the up-to-date message.
    writeFileSync(
      path.join(prisma, "schema.prisma"),
      "model User {\n  id Int @id\n}\n\nmodel Post {\n  id Int @id\n}\n",
      "utf8",
    );
    // check with drift in markdown → "regenerate it with …"
    await runCheck({ root, format: "markdown" });

    const suggestions = extractSuggestions(output.text());
    expect(suggestions).toEqual(
      expect.arrayContaining([
        `schemat snapshot --root ${root}`,
        `schemat check --root ${root}`,
        `schemat dev --root ${root}`,
      ]),
    );
    for (const s of suggestions) {
      assertRunnable(s);
      // No suggestion may silently drop the root the user passed.
      expect(s, `suggestion lost --root: ${s}`).toContain(`--root ${root}`);
    }
  });

  it("dev's port-conflict suggestions are runnable and keep --root", async () => {
    const root = path.join("apps", "api");
    const prisma = path.join(dir, root, "prisma");
    mkdirSync(prisma, { recursive: true });
    writeFileSync(path.join(prisma, "schema.prisma"), "model User {\n  id Int @id\n}\n", "utf8");

    // Hold a real port so `dev` hits EADDRINUSE rather than a mocked error.
    const blocker = createServer();
    const port = await new Promise<number>((resolve) => {
      blocker.listen(0, "127.0.0.1", () => {
        const address = blocker.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });

    const captured = captureOutput();

    try {
      await runDev({ root, port });
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }

    const output = stripAnsi(captured.text());
    expect(output).toContain(`Port ${port} is already in use.`);
    expect(process.exitCode).toBe(1);

    const suggestions = extractSuggestions(output);
    expect(suggestions).toEqual(
      expect.arrayContaining([
        `schemat dev --root ${root} --port ${port + 1}`,
        `schemat dev --root ${root} --port 0`,
      ]),
    );
    for (const s of suggestions) assertRunnable(s);
  });

  it("rejects a bad --port with a message naming schemat and the flag", async () => {
    const captured = captureOutput();

    await runDev({ root: ".", port: "abc" });

    const output = stripAnsi(captured.text());
    expect(output).toContain('Invalid --port "abc"');
    expect(process.exitCode).toBe(1);
    for (const s of extractSuggestions(output)) assertRunnable(s);
  });

  it("suggestions in a subdirectory root stay runnable and keep --root", async () => {
    const svc = path.join(dir, "apps", "api");
    mkdirSync(path.join(svc, "prisma"), { recursive: true });
    writeFileSync(
      path.join(svc, "prisma", "schema.prisma"),
      "model User {\n  id Int @id\n}\n",
      "utf8",
    );

    const captured = captureOutput();

    await runInit({ root: "apps/api" });

    const suggestions = extractSuggestions(captured.text());
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      assertRunnable(s);
      expect(s).toContain("--root apps/api");
    }
  });
});
