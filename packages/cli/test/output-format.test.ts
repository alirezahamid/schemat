import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCheck } from "../src/commands/check";
import { runDiff } from "../src/commands/diff";
import { colorEnabled, hasAnsi, paint, stripAnsi, symbol } from "../src/ui";

/**
 * Machine-readable output must never carry styling.
 *
 * This is the regression that breaks silently: colour looks fine to whoever
 * added it (their terminal renders it), while every consumer downstream —
 * `jq`, the GitHub Action's markdown comment, a redirected file — starts
 * receiving escape sequences inside the data.
 *
 * The guard forces colour ON (`FORCE_COLOR=1`) while capturing, so a leak
 * cannot hide behind "stdout wasn't a TTY during the test run".
 */

let dir: string;
let cwd: string;
const savedEnv = { ...process.env };

/**
 * Replace the environment wholesale.
 *
 * Building a fresh object (rather than deleting keys) is what makes "this
 * variable is UNSET" expressible — `process.env.X = undefined` stores the
 * string "undefined", which the colour rules would read as a real value.
 */
function setEnv(overrides: Record<string, string> = {}, unset: readonly string[] = []): void {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...savedEnv, ...overrides })) {
    if (value !== undefined && !unset.includes(key)) next[key] = value;
  }
  process.env = next;
}

/** Capture stdout and stderr separately — they are styled independently. */
function capture(): { stdout: () => string; stderr: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  vi.spyOn(console, "log").mockImplementation((...args) => out.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args) => err.push(args.join(" ")));
  return { stdout: () => out.join(""), stderr: () => err.join("") };
}

function writeSchema(root: string, body: string): void {
  const prisma = path.join(root, "prisma");
  mkdirSync(prisma, { recursive: true });
  writeFileSync(path.join(prisma, "schema.prisma"), body, "utf8");
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "schemat-ansi-"));
  cwd = process.cwd();
  process.chdir(dir);
  // Colour forced on: the point is to prove the JSON/markdown paths stay clean
  // even when everything else is styled.
  setEnv({ FORCE_COLOR: "1" }, ["NO_COLOR"]);
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
  process.exitCode = undefined;
});

describe("machine-readable output never contains ANSI", () => {
  it("diff --format json is byte-clean and parses", async () => {
    writeSchema(path.join(dir, "before"), "model User {\n  id Int @id\n}\n");
    writeSchema(
      path.join(dir, "after"),
      "model User {\n  id Int @id\n  email String\n}\n\nmodel Post {\n  id Int @id\n}\n",
    );

    const io = capture();
    await runDiff({ before: "before", after: "after", format: "json" });
    const stdout = io.stdout();

    expect(stdout).not.toBe("");
    expect(hasAnsi(stdout), `ANSI leaked into --format json:\n${JSON.stringify(stdout)}`).toBe(
      false,
    );
    // It must still be valid JSON — a leak would also break this, but parsing
    // separately makes the failure obvious.
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
  });

  it("diff --format markdown is byte-clean", async () => {
    writeSchema(path.join(dir, "before"), "model User {\n  id Int @id\n}\n");
    writeSchema(path.join(dir, "after"), "model User {\n  id Int @id\n  email String\n}\n");

    const io = capture();
    await runDiff({ before: "before", after: "after", format: "markdown" });

    expect(hasAnsi(io.stdout())).toBe(false);
  });

  it("check --format markdown (what the Action consumes) is byte-clean", async () => {
    const root = "apps/api";
    writeSchema(path.join(dir, root), "model User {\n  id Int @id\n}\n");

    // Snapshot first, then drift, so the report has content to style.
    const first = capture();
    const { runSnapshot } = await import("../src/commands/snapshot");
    await runSnapshot({ root });
    first.stdout();
    vi.restoreAllMocks();

    writeSchema(path.join(dir, root), "model User {\n  id Int @id\n  email String\n}\n");

    const io = capture();
    await runCheck({ root, format: "markdown" });
    const stdout = io.stdout();

    expect(stdout).toContain("Schemat: schema docs are out of date");
    expect(hasAnsi(stdout), `ANSI leaked into --format markdown:\n${JSON.stringify(stdout)}`).toBe(
      false,
    );
    expect(process.exitCode).toBe(1);
  });

  it("check --format text DOES style when colour is on, and the text survives stripping", async () => {
    const root = "apps/api";
    writeSchema(path.join(dir, root), "model User {\n  id Int @id\n}\n");

    const first = capture();
    const { runSnapshot } = await import("../src/commands/snapshot");
    await runSnapshot({ root });
    first.stdout();
    vi.restoreAllMocks();

    writeSchema(path.join(dir, root), "model User {\n  id Int @id\n  email String\n}\n");

    const io = capture();
    await runCheck({ root, format: "text" });
    const stdout = io.stdout();

    // Styling is expected here…
    expect(hasAnsi(stdout)).toBe(true);
    // …but it must be pure decoration: the payload is unchanged.
    expect(stripAnsi(stdout)).toContain("+ column  User.email");
    expect(process.exitCode).toBe(1);
  });
});

describe("copy-pasteable commands never carry styling", () => {
  it("suggestion lines in a coloured error contain no escape sequences", async () => {
    // A monorepo, so the "no schema here — try these roots" hint fires and the
    // error block prints real `schemat …` lines.
    for (const svc of ["identity", "billing"]) {
      writeSchema(path.join(dir, "apps", svc), "model User {\n  id Int @id\n}\n");
    }

    const io = capture();
    const { runSnapshot } = await import("../src/commands/snapshot");
    await runSnapshot({ root: "." });
    const stderr = io.stderr();

    // The block as a whole IS styled…
    expect(hasAnsi(stderr)).toBe(true);

    // …but every line that is a command must be copyable verbatim.
    const commandLines = stripAnsi(stderr)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("schemat "));
    expect(commandLines.length).toBeGreaterThan(0);

    for (const command of commandLines) {
      const raw = stderr.split("\n").find((l) => stripAnsi(l).trim() === command);
      expect(raw, `command line not found in raw output: ${command}`).toBeDefined();
      expect(
        hasAnsi((raw as string).trim()),
        `ANSI inside a copy-pasteable command: ${JSON.stringify(raw)}`,
      ).toBe(false);
    }
    expect(process.exitCode).toBe(1);
  });
});

describe("colour and symbol environment rules", () => {
  const stream = (isTTY: boolean) => ({ isTTY }) as unknown as NodeJS.WriteStream;

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("NO_COLOR disables colour for any value, including 0", () => {
    for (const value of ["", "1", "0", "false"]) {
      setEnv({ NO_COLOR: value }, ["FORCE_COLOR"]);
      // The spec is about presence: only an EMPTY value is ignored.
      expect(colorEnabled(stream(true)), `NO_COLOR=${JSON.stringify(value)}`).toBe(value === "");
    }
  });

  it("FORCE_COLOR=0 turns colour off even on a TTY", () => {
    setEnv({ FORCE_COLOR: "0" });
    expect(colorEnabled(stream(true))).toBe(false);
  });

  it("FORCE_COLOR=1 turns colour on for a non-TTY", () => {
    setEnv({ FORCE_COLOR: "1" }, ["NO_COLOR"]);
    expect(colorEnabled(stream(false))).toBe(true);
  });

  it("auto-detects per stream, not globally", () => {
    setEnv({ TERM: "xterm-256color" }, ["NO_COLOR", "FORCE_COLOR"]);
    // A redirected stdout must not drag stderr's styling down with it, and
    // vice versa: each stream answers for itself.
    expect(colorEnabled(stream(false))).toBe(false);
    expect(colorEnabled(stream(true))).toBe(true);
  });

  it("TERM=dumb disables colour", () => {
    setEnv({ TERM: "dumb" }, ["NO_COLOR", "FORCE_COLOR"]);
    expect(colorEnabled(stream(true))).toBe(false);
  });

  it("paint is a no-op when colour is off", () => {
    setEnv({ NO_COLOR: "1" });
    expect(paint(stream(true), "success", "done")).toBe("done");
  });

  it("falls back to ASCII symbols in a non-UTF-8 locale", () => {
    setEnv({ LC_ALL: "C", LC_CTYPE: "C", LANG: "C" });
    expect(symbol("success")).toBe("v");
    expect(symbol("error")).toBe("x");
    expect(symbol("warning")).toBe("!");
    expect(symbol("arrow")).toBe("->");
  });

  it("uses Unicode symbols in a UTF-8 locale", () => {
    setEnv({ LC_ALL: "en_US.UTF-8" });
    expect(symbol("success")).toBe("✔");
    expect(symbol("error")).toBe("✖");
    expect(symbol("warning")).toBe("⚠");
  });
});
