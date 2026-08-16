/**
 * Terminal presentation: the single place that decides whether output gets
 * colour and Unicode, and the only place that emits escape sequences.
 *
 * Rules everything else depends on:
 *  - The decision is PER STREAM. stdout being a TTY says nothing about stderr
 *    (`schemat check > report.txt` leaves stderr a terminal, and vice versa).
 *  - Machine-readable output (`--format json` / `markdown`, files) never goes
 *    through here, so it cannot pick up styling by accident.
 *  - Colour is decoration only: strip every escape sequence and the text — and
 *    every copy-pasteable `schemat …` command inside it — must be unchanged.
 */
import { styleText } from "node:util";

/** Styles used across the CLI, named by meaning rather than by colour. */
export type StyleName =
  | "success"
  | "error"
  | "warning"
  | "info"
  | "heading"
  | "muted"
  | "strong"
  | "added"
  | "removed"
  | "changed";

type Ansi = Parameters<typeof styleText>[0];

const STYLES: Record<StyleName, Ansi> = {
  success: "green",
  error: "red",
  warning: "yellow",
  info: "cyan",
  heading: ["bold"],
  muted: "gray",
  strong: ["bold"],
  added: "green",
  removed: "red",
  changed: "yellow",
};

/** Streams the CLI writes human output to. */
export type OutputStream = NodeJS.WriteStream | (NodeJS.WritableStream & { isTTY?: boolean });

/**
 * Explicit environment override, if any.
 *
 * `NO_COLOR` (https://no-color.org): present and non-empty disables colour,
 * whatever the value — including `NO_COLOR=0`, because the spec is about
 * presence, not truthiness.
 *
 * `FORCE_COLOR` re-enables it, and `FORCE_COLOR=0` (or `false`) forces it off.
 * FORCE_COLOR wins over NO_COLOR: it is the more specific, deliberately-typed
 * override, and that matches what chalk/picocolors users already expect.
 */
function envOverride(): boolean | undefined {
  const force = process.env.FORCE_COLOR;
  if (force !== undefined) return !(force === "0" || force === "false");
  const no = process.env.NO_COLOR;
  if (no !== undefined && no !== "") return false;
  return undefined;
}

/** True when it is safe to write ANSI colour to this specific stream. */
export function colorEnabled(stream: OutputStream): boolean {
  const override = envOverride();
  if (override !== undefined) return override;
  // A terminal that says it cannot render attributes is taken at its word.
  if (process.env.TERM === "dumb") return false;
  return Boolean((stream as { isTTY?: boolean }).isTTY);
}

/**
 * True when the terminal can be trusted with non-ASCII glyphs. A non-UTF-8
 * locale prints mojibake instead of `✓`, which looks worse than plain ASCII,
 * and legacy Windows consoles do the same regardless of locale.
 */
export function unicodeEnabled(): boolean {
  const locale = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "";
  if (process.platform === "win32") {
    // Windows Terminal / VS Code render Unicode; conhost.exe historically does not.
    return Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.ConEmuTask);
  }
  if (!locale) return false;
  return /utf-?8/i.test(locale);
}

/** Symbol vocabulary, with the ASCII fallback each glyph degrades to. */
const SYMBOLS = {
  success: ["✔", "v"],
  error: ["✖", "x"],
  warning: ["⚠", "!"],
  info: ["ℹ", "i"],
  arrow: ["→", "->"],
  bullet: ["•", "-"],
  added: ["+", "+"],
  removed: ["-", "-"],
  changed: ["~", "~"],
  reload: ["↻", "*"],
} as const;

export type SymbolName = keyof typeof SYMBOLS;

/** The glyph for `name`, downgraded to ASCII when the terminal can't render it. */
export function symbol(name: SymbolName): string {
  const [unicode, ascii] = SYMBOLS[name];
  return unicodeEnabled() ? unicode : ascii;
}

/**
 * Apply a style, but only if `stream` may carry colour.
 *
 * `validateStream: false` because the decision is ours: Node's own check looks
 * at stdout/stderr generically and ignores NO_COLOR/FORCE_COLOR precedence the
 * way we want it.
 */
export function paint(stream: OutputStream, style: StyleName, text: string): string {
  if (!colorEnabled(stream) || text === "") return text;
  return styleText(STYLES[style], text, { validateStream: false });
}

/** Remove every ANSI escape sequence — used by tests and by piped-output guards. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC is the point
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/** True when `text` carries any ANSI escape sequence. */
export function hasAnsi(text: string): boolean {
  return stripAnsi(text) !== text;
}

function line(stream: OutputStream, style: StyleName, sym: SymbolName, message: string): string {
  return `  ${paint(stream, style, symbol(sym))} ${message}`;
}

/** `  ✔ message` on stdout, green when stdout is a colour terminal. */
export function success(message: string): void {
  process.stdout.write(`${line(process.stdout, "success", "success", message)}\n`);
}

/** `  ✖ message` on stderr. Never touches stdout, so redirected output stays clean. */
export function failure(message: string): void {
  process.stderr.write(`${line(process.stderr, "error", "error", message)}\n`);
}

/** `  ⚠ message` on stderr — parser warnings and other non-fatal notices. */
export function warning(message: string): void {
  process.stderr.write(`${line(process.stderr, "warning", "warning", message)}\n`);
}

/** `  ℹ message` on stdout. */
export function info(message: string): void {
  process.stdout.write(`${line(process.stdout, "info", "info", message)}\n`);
}

/** An indented, de-emphasised continuation line under a previous message. */
export function detail(message: string, stream: OutputStream = process.stdout): void {
  stream.write(`    ${paint(stream, "muted", message)}\n`);
}

/** A line whose content is a runnable command rather than prose. */
const COMMAND_LINE = /^\s*schemat\s/;

/**
 * Render a multi-line error with hierarchy: headline, detail, then the
 * suggested command.
 *
 * The suggestion is printed VERBATIM and unstyled — a user copying a coloured
 * command line would otherwise paste escape sequences into their shell. Only
 * the surrounding prose is decorated.
 */
export function errorBlock(headline: string, body?: string, suggestions?: readonly string[]): void {
  const err = process.stderr;
  // A message from a third-party parser arrives as one multi-line blob. Only
  // its first line is the headline; the rest is detail, or the "headline"
  // becomes a bold wall of text.
  const [first = headline, ...rest] = headline.split("\n");
  const detailLines = [...rest, ...(body ? body.split("\n") : [])];

  err.write(`\n  ${paint(err, "error", symbol("error"))} ${paint(err, "strong", first)}\n`);
  for (const l of detailLines) {
    if (!l) {
      err.write("\n");
    } else if (hasAnsi(l)) {
      // Already styled by whoever produced it (e.g. Prisma's own validation
      // output). Wrapping it again interleaves reset codes and corrupts both —
      // pass it through, or strip it when this stream may not carry colour.
      err.write(`    ${colorEnabled(err) ? l : stripAnsi(l)}\n`);
    } else if (COMMAND_LINE.test(l)) {
      // A line that IS a command stays raw, so selecting it in a terminal
      // yields exactly the characters that need to reach the shell.
      err.write(`    ${l}\n`);
    } else {
      err.write(`    ${paint(err, "muted", l)}\n`);
    }
  }
  if (suggestions?.length) {
    err.write("\n");
    for (const command of suggestions) {
      // Command text stays raw; only the leading marker is styled.
      err.write(`    ${paint(err, "muted", symbol("bullet"))} ${command}\n`);
    }
  }
  err.write("\n");
}

/** The `→` separator, or `->` where Unicode isn't safe. */
export function arrow(): string {
  return symbol("arrow");
}

/**
 * The one-line schema summary shared by init / snapshot / export, so the same
 * facts read the same way whichever command printed them.
 */
export function counts(schema: {
  tables: readonly unknown[];
  relations: readonly unknown[];
  enums: readonly unknown[];
}): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [
    plural(schema.tables.length, "table"),
    plural(schema.relations.length, "relation"),
    plural(schema.enums.length, "enum"),
  ].join(", ");
}

/** A styled section heading, e.g. the `dev` banner title. */
export function heading(text: string, stream: OutputStream = process.stdout): string {
  return paint(stream, "heading", text);
}
