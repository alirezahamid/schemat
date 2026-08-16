import { useCallback, useEffect, useState } from "react";
import {
  type ThemeChoice,
  applyTheme,
  onSystemThemeChange,
  readThemeChoice,
  resolveTheme,
  writeThemeChoice,
} from "./theme";

const OPTIONS: { value: ThemeChoice; label: string; title: string }[] = [
  { value: "system", label: "Auto", title: "Follow the system theme" },
  { value: "light", label: "Light", title: "Always use the light theme" },
  { value: "dark", label: "Dark", title: "Always use the dark theme" },
];

/**
 * Three-state theme control: system / light / dark. "Auto" is the default and
 * stays live — flipping the OS setting flips the canvas without a reload.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice());

  // Re-apply on choice change, and while on "system" track the OS setting.
  useEffect(() => {
    applyTheme(resolveTheme(choice));
    if (choice !== "system") return;
    return onSystemThemeChange((theme) => applyTheme(theme));
  }, [choice]);

  const pick = useCallback((next: ThemeChoice) => {
    writeThemeChoice(next);
    setChoice(next);
  }, []);

  return (
    <fieldset className="theme-toggle" aria-label="Theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="theme-btn"
          title={opt.title}
          aria-pressed={choice === opt.value}
          onClick={() => pick(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </fieldset>
  );
}
