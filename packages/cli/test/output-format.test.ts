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
  process.env.FORCE_COLOR = "1";
  process.env.NO_COLOR = undefined;
  delete process.env.NO_COLOR;
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

describe("colour and symbol environment rules", () => {
  const stream = (isTTY: boolean) => ({ isTTY }) as unknown as NodeJS.WriteStream;

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("NO_COLOR disables colour for any value, including 0", () => {
    for (const value of ["", "1", "0", "false"]) {
      process.env = { ...savedEnv };
      process.env.NO_COLOR = value;
      delete process.env.FORCE_COLOR;
      // The spec is about presence: only an EMPTY value is ignored.
      expect(colorEnabled(stream(true)), `NO_COLOR=${JSON.stringify(value)}`).toBe(value === "");
    }
  });

  it("FORCE_COLOR=0 turns colour off even on a TTY", () => {
    process.env = { ...savedEnv };
    process.env.FORCE_COLOR = "0";
    expect(colorEnabled(stream(true))).toBe(false);
  });

  it("FORCE_COLOR=1 turns colour on for a non-TTY", () => {
    process.env = { ...savedEnv };
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    expect(colorEnabled(stream(false))).toBe(true);
  });

  it("auto-detects per stream, not globally", () => {
    process.env = { ...savedEnv };
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    process.env.TERM = "xterm-256color";
    // A redirected stdout must not drag stderr's styling down with it, and
    // vice versa: each stream answers for itself.
    expect(colorEnabled(stream(false))).toBe(false);
    expect(colorEnabled(stream(true))).toBe(true);
  });

  it("TERM=dumb disables colour", () => {
    process.env = { ...savedEnv };
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    process.env.TERM = "dumb";
    expect(colorEnabled(stream(true))).toBe(false);
  });

  it("paint is a no-op when colour is off", () => {
    process.env = { ...savedEnv };
    process.env.NO_COLOR = "1";
    expect(paint(stream(true), "success", "done")).toBe("done");
  });

  it("falls back to ASCII symbols in a non-UTF-8 locale", () => {
    process.env = { ...savedEnv };
    process.env.LC_ALL = "C";
    process.env.LC_CTYPE = "C";
    process.env.LANG = "C";
    expect(symbol("success")).toBe("v");
    expect(symbol("error")).toBe("x");
    expect(symbol("warning")).toBe("!");
    expect(symbol("arrow")).toBe("->");
  });

  it("uses Unicode symbols in a UTF-8 locale", () => {
    process.env = { ...savedEnv };
    process.env.LC_ALL = "en_US.UTF-8";
    expect(symbol("success")).toBe("✔");
    expect(symbol("error")).toBe("✖");
    expect(symbol("warning")).toBe("⚠");
  });
});
