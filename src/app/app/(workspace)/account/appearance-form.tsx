"use client";

import { THEME_OPTIONS } from "../shell/parts";
import { useShell } from "../shell/use-shell";

const HINTS: Record<string, string> = {
  system: "Follows your phone or computer",
  light: "Always light",
  dark: "Always dark",
};

/**
 * The theme choice as a radio group (design system step 4c): the same three options and the
 * same saved preference as the account menu and the command palette. Applies at once.
 */
export function AppearanceForm() {
  const { theme, setTheme } = useShell();
  // "Device" first here: it is the default and the usual choice.
  const options = [...THEME_OPTIONS].sort(
    (a, b) => Number(b.value === "system") - Number(a.value === "system"),
  );
  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {options.map(({ value, label, Icon }) => (
          <label
            key={value}
            className="has-[:checked]:border-primary has-[:checked]:bg-brand-subtle has-[:focus-visible]:ring-ring hover:bg-muted/60 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 motion-reduce:transition-none"
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={theme === value}
              onChange={() => setTheme(value)}
              className="accent-primary size-4 shrink-0 outline-none"
            />
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Icon aria-hidden="true" className="text-muted-foreground size-4" />
                {label}
              </span>
              <span className="text-muted-foreground text-xs">{HINTS[value]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
