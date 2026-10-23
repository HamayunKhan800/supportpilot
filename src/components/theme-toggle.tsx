"use client";

import { cn } from "cn";
import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { applyTheme } from "@/lib/preferences-client";
import type { ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light theme", Icon: Sun },
  { value: "dark", label: "Dark theme", Icon: Moon },
  { value: "system", label: "Use device theme", Icon: Monitor },
];

/**
 * Three-way theme switch. The server renders the initial theme from the cookie; a click
 * updates the cookie and <html data-theme> at once, so the page re-themes without a reload.
 */
export function ThemeToggle({ initial }: { initial: ThemePreference }) {
  const [preference, setPreference] = useState<ThemePreference>(initial);

  function choose(next: ThemePreference) {
    applyTheme(next);
    setPreference(next);
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className="border-border inline-flex gap-0.5 rounded-md border p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={preference === value}
          title={label}
          onClick={() => choose(value)}
          className={cn(
            "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-ring inline-flex size-7 items-center justify-center rounded-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1",
            preference === value &&
              "bg-brand-subtle text-brand-strong hover:bg-brand-subtle hover:text-brand-strong",
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      ))}
    </div>
  );
}
