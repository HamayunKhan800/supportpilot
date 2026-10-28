"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Check, CircleUser, Hash, Keyboard, LogOut, type LucideIcon, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { type Command, matchCommands, type NavItem, parseTicketNumber } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { NAV_ICON, THEME_OPTIONS, useSignOut } from "./parts";
import { useShell } from "./use-shell";
import { useProgressRouter } from "@/lib/use-progress-router";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

interface PaletteCommand extends Command {
  Icon: LucideIcon;
  run: () => void;
  /** Marks the option that is already in effect (e.g. the current theme). */
  current?: boolean;
}

/**
 * Ctrl/⌘ K command palette: jump to any page, open a ticket by number, search tickets,
 * switch theme, sign out. A dialog with the WAI-ARIA combobox + listbox pattern: focus
 * stays in the text box and the arrow keys move the highlighted option.
 */
export function CommandPalette({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: NavItem[];
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="bg-background/70 fixed inset-0 z-50 backdrop-blur-[2px]" />
        <Dialog.Popup className="glass text-popover-foreground fixed top-[12vh] left-1/2 z-50 max-h-[76vh] w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 scroll-pt-14 scroll-pb-11 overflow-y-auto overscroll-contain rounded-xl border shadow-2xl outline-none">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <PaletteBody items={items} close={() => onOpenChange(false)} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Mounted only while open, so the query and highlight reset every time. */
function PaletteBody({ items, close }: { items: NavItem[]; close: () => void }) {
  const router = useProgressRouter();
  const signOut = useSignOut();
  const { theme, setTheme, openShortcuts } = useShell();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const commands = useMemo<PaletteCommand[]>(() => {
    const go = (href: string) => () => {
      close();
      router.push(href);
    };
    return [
      ...items.map((item) => ({
        id: `go:${item.href}`,
        label: item.label,
        group: "Go to",
        keywords: item.keywords,
        Icon: NAV_ICON[item.icon],
        run: go(item.href),
      })),
      {
        id: "go:/app/account",
        label: "Account",
        group: "Go to",
        keywords: "profile password security",
        Icon: CircleUser,
        run: go("/app/account"),
      },
      ...THEME_OPTIONS.map(({ value, label, Icon }) => ({
        id: `theme:${value}`,
        label: value === "system" ? "Use device theme" : `${label} theme`,
        group: "Theme",
        keywords: "theme appearance mode colour color",
        Icon,
        current: theme === value,
        run: () => {
          setTheme(value);
          close();
        },
      })),
      {
        id: "help:shortcuts",
        label: "Keyboard shortcuts",
        group: "Help",
        keywords: "keys hotkeys help",
        Icon: Keyboard,
        run: () => {
          close();
          openShortcuts();
        },
      },
      {
        id: "account:sign-out",
        label: "Sign out",
        group: "Account",
        keywords: "log out logout",
        Icon: LogOut,
        run: () => {
          close();
          void signOut();
        },
      },
    ];
  }, [items, theme, setTheme, openShortcuts, close, router, signOut]);

  const results = useMemo<PaletteCommand[]>(() => {
    const text = query.trim();
    const number = parseTicketNumber(text);
    const go = (href: string) => () => {
      close();
      router.push(href);
    };
    // A ticket number is specific, so it goes first; a free-text ticket search is the
    // fallback after the pages and commands that match.
    const before: PaletteCommand[] = [];
    const after: PaletteCommand[] = [];
    if (number) {
      before.push({
        id: "ticket:open",
        label: `Open ticket #${number}`,
        group: "Tickets",
        Icon: Hash,
        run: go(`/app/tickets/${number}`),
      });
    } else if (text) {
      after.push({
        id: "ticket:search",
        label: `Search tickets for “${text}”`,
        group: "Tickets",
        Icon: Search,
        run: go(`/app/tickets?q=${encodeURIComponent(text)}`),
      });
    }
    return [...before, ...matchCommands(text, commands), ...after];
  }, [query, commands, close, router]);

  const current = Math.min(active, results.length - 1);
  const groups = useMemo(() => {
    const out: { group: string; options: { command: PaletteCommand; index: number }[] }[] = [];
    results.forEach((command, index) => {
      const last = out.at(-1);
      if (last?.group === command.group) last.options.push({ command, index });
      else out.push({ group: command.group, options: [{ command, index }] });
    });
    return out;
  }, [results]);

  function move(next: number) {
    if (!results.length) return;
    const index = (next + results.length) % results.length;
    setActive(index);
    document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") move(current + 1);
    else if (e.key === "ArrowUp") move(current - 1);
    else if (e.key === "Enter" && results[current]) results[current].run();
    else return;
    e.preventDefault();
  }

  return (
    <>
      {/* The whole popup scrolls with the search box pinned on top, so the scroll area holds the
          focused text box and stays keyboard-reachable (axe scrollable-region-focusable). */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b px-3">
        <Search aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
        <input
          role="combobox"
          aria-label="Search or jump to"
          aria-expanded={results.length > 0}
          aria-controls={results.length ? listId : undefined}
          aria-activedescendant={results.length ? optionId(current) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder="Pages, settings, or a ticket number like #12"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="placeholder:text-muted-foreground h-12 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm"
        />
        <Dialog.Close className="hover:bg-accent text-muted-foreground inline-flex h-6 items-center rounded px-1.5 text-xs">
          <span className="sr-only">Close</span>
          <span aria-hidden="true">Esc</span>
        </Dialog.Close>
      </div>

      <div className="p-1.5">
        {results.length ? (
          <div role="listbox" id={listId} aria-label="Results">
            {groups.map(({ group, options }) => (
              <div key={group} role="group" aria-labelledby={`${listId}-${slug(group)}`}>
                <div
                  id={`${listId}-${slug(group)}`}
                  aria-hidden="true"
                  className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium"
                >
                  {group}
                </div>
                {options.map(({ command, index }) => (
                  <div
                    key={command.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === current}
                    onPointerMove={() => index !== current && setActive(index)}
                    onClick={() => command.run()}
                    className={cn(
                      "flex h-9 cursor-pointer items-center gap-3 rounded-md px-2 text-sm select-none",
                      index === current && "bg-accent text-accent-foreground",
                    )}
                  >
                    <command.Icon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate">{command.label}</span>
                    {command.current && (
                      <span className="text-brand-strong ml-auto inline-flex items-center gap-1 text-xs">
                        <Check aria-hidden="true" className="size-3.5" />
                        Current
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground px-3 py-8 text-center text-sm" role="status">
            No matches. Try a page name, “dark”, or a ticket number such as #12.
          </p>
        )}
      </div>

      <div
        aria-hidden="true"
        className="text-muted-foreground sticky bottom-0 hidden items-center gap-4 border-t px-3 py-2 text-xs sm:flex"
      >
        <span className="inline-flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>↵</Kbd> to open
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Esc</Kbd> to close
        </span>
      </div>
    </>
  );
}
