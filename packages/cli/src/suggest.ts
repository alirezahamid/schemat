/**
 * Copy-pasteable command suggestions.
 *
 * Every `schemat …` string the CLI prints must run verbatim when pasted. That
 * means it has to carry the subcommand the user invoked and the `--root` they
 * already passed — a bare `schemat --root apps/api` is not a valid command.
 */

/** What the user actually typed, threaded into every suggestion we emit. */
export interface Invocation {
  /** The invoked subcommand: "dev", "init", "export", "snapshot", "check". */
  command: string;
  /** The user-supplied `--root`, if any (commander defaults it to "."). */
  root?: string;
}

/** Quote a shell argument only when it needs it. */
function shellArg(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a runnable command line: `schemat <command> [--root <dir>] [extra…]`.
 * The root is omitted when it is the default ".", so suggestions stay short.
 */
export function suggestCommand(
  command: string,
  options: { root?: string; extra?: readonly string[] } = {},
): string {
  const parts = ["schemat", command];
  if (options.root && options.root !== ".") parts.push("--root", shellArg(options.root));
  if (options.extra) parts.push(...options.extra);
  return parts.join(" ");
}
