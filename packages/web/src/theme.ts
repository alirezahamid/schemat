/**
 * Theme state: follow the OS by default, with an explicit choice that persists
 * and wins over the system setting.
 *
 * The pre-paint inline script in index.html applies the same rule before React
 * mounts (no flash of the wrong theme); keep the two in sync — the storage key
 * and the `data-theme` attribute are the contract between them.
 */

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "schemat:theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Read the persisted choice. Anything unrecognised falls back to "system". */
export function readThemeChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Private mode / disabled storage — behave as "system".
  }
  return "system";
}

/** Persist the choice; "system" clears the override so auto-follow resumes. */
export function writeThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Best-effort: an unpersisted choice still applies for this session.
  }
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === "system" ? systemTheme() : choice;
}

/** Paint the resolved theme onto <html> — every token is scoped to this attribute. */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/** Subscribe to OS theme changes. Returns an unsubscribe function. */
export function onSystemThemeChange(fn: (theme: ResolvedTheme) => void): () => void {
  const mql = window.matchMedia?.(DARK_QUERY);
  if (!mql) return () => {};
  const handler = (e: MediaQueryListEvent) => fn(e.matches ? "dark" : "light");
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}
