"use client";

import {
  BarChart3,
  BookOpen,
  CornerDownLeft,
  FlaskConical,
  Hash,
  History,
  Inbox,
  Keyboard,
  LayoutGrid,
  type LucideIcon,
  Monitor,
  Moon,
  Search,
  Settings2,
  Sun,
  Users,
} from "lucide-react";
import { type KeyboardEvent, useId, useMemo, useState } from "react";
import { type Command, matchCommands, parseTicketNumber } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { Keys } from "./mock";

interface DemoCommand extends Command {
  Icon: LucideIcon;
  /** What the app does when this runs, said after Enter. */
  does: string;
}

/**
 * The commands an owner sees in the real palette (command-palette.tsx and the workspace layout's
 * page list), with the same labels and search keywords. Sign out is left out of the demo.
 */
const COMMANDS: DemoCommand[] = [
  ["Overview", LayoutGrid, "home dashboard"],
  ["Tickets", Inbox, "inbox requests conversations"],
  ["Knowledge", BookOpen, "help articles documents search"],
  ["Analytics", BarChart3, "usage reports charts"],
  ["Evaluation", FlaskConical, "ai quality accuracy eval"],
  ["Members", Users, "team invite people"],
  ["AI settings", Settings2, "model budget categories"],
  ["Audit log", History, "history security"],
].map(([label, Icon, keywords]) => ({
  id: `go:${label as string}`,
  label: label as string,
  group: "Go to",
  keywords: keywords as string,
  Icon: Icon as LucideIcon,
  does: `opens ${label as string}`,
}));
COMMANDS.push(
  ...(
    [
      ["Light theme", Sun],
      ["Dark theme", Moon],
      ["Use device theme", Monitor],
    ] as const
  ).map(([label, Icon]) => ({
    id: `theme:${label}`,
    label,
    group: "Theme",
    keywords: "theme appearance mode colour color",
    Icon,
    does: `switches to the ${label.replace(" theme", "").replace("Use ", "").toLowerCase()} theme`,
  })),
  {
    id: "help:shortcuts",
    label: "Keyboard shortcuts",
    group: "Help",
    keywords: "keys hotkeys help",
    Icon: Keyboard,
    does: "lists every shortcut",
  },
);

/** The palette's own rules: a ticket number goes first; other text adds a ticket search last. */
export function paletteResults(query: string): DemoCommand[] {
  const text = query.trim();
  const number = parseTicketNumber(text);
  const before: DemoCommand[] = [];
  const after: DemoCommand[] = [];
  if (number) {
    before.push({
      id: "ticket:open",
      label: `Open ticket #${number}`,
      group: "Tickets",
      Icon: Hash,
      does: `opens ticket #${number}`,
    });
  } else if (text) {
    after.push({
      id: "ticket:search",
      label: `Search tickets for “${text}”`,
      group: "Tickets",
      Icon: Search,
      does: "searches your tickets",
    });
  }
  return [...before, ...matchCommands(text, COMMANDS), ...after];
}

/**
 * The command palette, working (design step 9.3): type to filter, arrow keys to move, Enter to
 * run. Matching is the app's own code (src/lib/navigation.ts). It's an ARIA combobox with a
 * listbox, like the real one; running a command only says what the app would do.
 */
export function PaletteScene() {
  const [query, setQuery] = useState("128");
  const [active, setActive] = useState(0);
  const [ran, setRan] = useState<string | null>(null);
  const id = useId();
  // The first five, so the box keeps one size; the app lists them all.
  const all = useMemo(() => paletteResults(query), [query]);
  const list = all.slice(0, 5);
  const current = Math.min(active, list.length - 1);
  const optionId = (i: number) => `${id}-option-${i}`;

  const groups: { group: string; options: { c: DemoCommand; i: number }[] }[] = [];
  list.forEach((c, i) => {
    const last = groups.at(-1);
    if (last?.group === c.group) last.options.push({ c, i });
    else groups.push({ group: c.group, options: [{ c, i }] });
  });

  const run = (c: DemoCommand | undefined) => {
    if (c) setRan(`In the app, this ${c.does}.`);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + list.length) % list.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(list[current]);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
      setActive(0);
      setRan(null);
    }
  };

  return (
    <div className="relative flex flex-col items-center gap-5">
      <div className="bg-popover text-popover-foreground land-shadow w-full max-w-md overflow-hidden rounded-xl border text-left text-[13px]">
        <label className="flex items-center gap-2 border-b px-3.5">
          <Search aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
          <span className="sr-only">Try the command palette: type a page, a command or a ticket number</span>
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={list.length ? optionId(current) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setRan(null);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search or jump to…"
            className="placeholder:text-muted-foreground h-11 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-[13px]"
          />
          <span aria-hidden="true" className="text-muted-foreground shrink-0">
            <Keys keys={["Esc"]} />
          </span>
        </label>
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label="Results"
          className="flex h-64 flex-col gap-1 overflow-hidden p-1.5"
        >
          {groups.map((g) => (
            <div key={g.group} role="group" aria-labelledby={`${id}-${g.group}`} className="flex flex-col">
              <span
                id={`${id}-${g.group}`}
                className="text-muted-foreground px-2 pt-1.5 pb-1 text-[11px] font-medium"
              >
                {g.group}
              </span>
              {g.options.map(({ c, i }) => (
                <div
                  key={c.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === current}
                  onMouseMove={() => i !== current && setActive(i)}
                  onClick={() => run(c)}
                  className={cn(
                    "flex h-8 shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-2",
                    i === current && "bg-accent",
                  )}
                >
                  <c.Icon aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="truncate">{c.label}</span>
                  {i === current && (
                    <CornerDownLeft
                      aria-hidden="true"
                      className="text-muted-foreground ml-auto size-3.5 shrink-0"
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
          {list.length === 0 && <p className="text-muted-foreground px-2 py-6 text-center">No results</p>}
        </div>
        <p
          aria-live="polite"
          className="text-muted-foreground flex min-h-9 items-center border-t px-3.5 py-2 text-xs"
        >
          {ran ??
            (all.length > list.length
              ? `First ${list.length} of ${all.length} results. Try “team”, “dark” or “#42”.`
              : `${all.length} ${all.length === 1 ? "result" : "results"}. Try “team”, “dark” or “#42”.`)}
        </p>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
        <span className="flex items-center gap-2">
          <Keys keys={["Ctrl", "K"]} /> Search or jump
        </span>
        <span className="flex items-center gap-2">
          <Keys keys={["J", "K"]} /> Next and previous ticket
        </span>
        <span className="flex items-center gap-2">
          <Keys keys={["?"]} /> All shortcuts
        </span>
      </div>
    </div>
  );
}
