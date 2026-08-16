import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TOKENS_CSS = join(dirname(fileURLToPath(import.meta.url)), "../src/styles/tokens.css");

/** Hex tokens declared inside one CSS rule, keyed by custom-property name. */
type Palette = Record<string, string>;

/**
 * Pull `--name: #hex;` declarations out of the rule whose selector list contains
 * `selector`. Parsing the real file (rather than duplicating the palette here)
 * is the point: editing a token must be able to fail this suite.
 */
function parsePalette(css: string, selector: string): Palette {
  const palette: Palette = {};
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of stripped.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of (match[2] ?? "").matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      const name = decl[1];
      const hex = decl[2];
      if (name && hex) palette[name] = hex.toLowerCase();
    }
  }
  return palette;
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const int = Number.parseInt(hex.slice(1), 16);
  const channels = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
  const [r, g, b] = channels.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const css = readFileSync(TOKENS_CSS, "utf8");

const THEMES = {
  dark: parsePalette(css, ':root[data-theme="dark"]'),
  light: parsePalette(css, ':root[data-theme="light"]'),
} as const;

const SURFACES = ["--s-bg", "--s-surface", "--s-raised"] as const;
const TEXT_ROLES = [
  "--s-text",
  "--s-text-strong",
  "--s-text-dim",
  "--s-accent",
  "--s-link",
  "--s-pk",
  "--s-fk",
  "--s-ok",
] as const;

const TEXT_MIN = 4.5; // WCAG AA, normal text
const NON_TEXT_MIN = 3.0; // WCAG AA, UI component boundaries

describe.each(Object.entries(THEMES))("%s theme", (_theme, palette) => {
  it("declares every surface and text role", () => {
    for (const token of [...SURFACES, ...TEXT_ROLES, "--s-border-strong"]) {
      expect(palette[token], `${token} missing from tokens.css`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(TEXT_ROLES)(`%s is >= ${TEXT_MIN}:1 on every surface`, (role) => {
    for (const surface of SURFACES) {
      const fg = palette[role];
      const bg = palette[surface];
      if (!fg || !bg) throw new Error(`missing token: ${role} / ${surface}`);
      const ratio = contrast(fg, bg);
      expect(
        Number(ratio.toFixed(2)),
        `${role} (${fg}) on ${surface} (${bg}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it(`--s-border-strong is >= ${NON_TEXT_MIN}:1 on --s-bg`, () => {
    const fg = palette["--s-border-strong"];
    const bg = palette["--s-bg"];
    if (!fg || !bg) throw new Error("missing border/bg token");
    const ratio = contrast(fg, bg);
    expect(
      Number(ratio.toFixed(2)),
      `${fg} on ${bg} = ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(NON_TEXT_MIN);
  });
});

describe("contrast maths", () => {
  it("matches known WCAG reference ratios", () => {
    expect(Number(contrast("#000000", "#ffffff").toFixed(2))).toBe(21);
    expect(Number(contrast("#ffffff", "#ffffff").toFixed(2))).toBe(1);
    // The failure this suite exists to catch: green that passes on --s-bg but
    // not on --s-raised in the light theme.
    expect(contrast("#15803d", "#f0f0f0")).toBeLessThan(TEXT_MIN);
  });

  it("parses tokens from the real stylesheet, not a copy", () => {
    expect(Object.keys(THEMES.dark).length).toBeGreaterThan(10);
    expect(THEMES.dark["--s-bg"]).not.toBe(THEMES.light["--s-bg"]);
  });
});
