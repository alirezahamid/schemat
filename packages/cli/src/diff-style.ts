/**
 * Colour for `renderDiffText` output.
 *
 * Deliberately a post-processing pass in the CLI rather than an option on
 * `renderDiffText`: the renderer keeps producing one canonical, byte-clean
 * string that `--format markdown` and the GitHub Action still consume, and
 * only the terminal path adds escapes on top of it.
 */
import { paint } from "./ui";

/** `+ table users` → added, `- …` → removed, `~ …` → changed. */
function styleForLine(text: string): "added" | "removed" | "changed" | null {
  if (text.startsWith("+ ")) return "added";
  if (text.startsWith("- ")) return "removed";
  if (text.startsWith("~ ")) return "changed";
  return null;
}

/**
 * Colourise the text diff for a terminal. Returns the input unchanged when the
 * target stream may not carry colour, so callers can pipe this straight to
 * stdout without checking first.
 *
 * Line CONTENT is never rewritten when colour is off — the plain output is
 * byte-identical to what the renderer produced.
 */
export function styleDiffText(text: string, stream: NodeJS.WriteStream): string {
  const lines = text.split("\n");
  const styled = lines.map((line) => {
    const style = styleForLine(line);
    // Only the colour is added. The line's characters (including the renderer's
    // `→`) are left exactly as produced — rewriting them here would change the
    // output of a command that people redirect into files.
    if (style) return paint(stream, style, line);
    // The trailing summary line: "N change(s): +a added, -r removed, ~c changed".
    if (/^\d+ change\(s\):/.test(line)) return paint(stream, "strong", line);
    if (line === "No schema changes.") return paint(stream, "success", line);
    return line;
  });
  return styled.join("\n");
}
