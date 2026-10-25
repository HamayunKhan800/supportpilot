"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronsUpDown, CircleUser, Keyboard, LogOut } from "lucide-react";
import Link from "next/link";
import { Kbd } from "@/components/ui/kbd";
import { parseThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { initials, THEME_OPTIONS, useSignOut } from "./parts";
import { useShell } from "./use-shell";

const ITEM =
  "flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0";
const LABEL = "text-muted-foreground px-2 pt-1.5 pb-1 text-xs font-medium";

/** Bottom of the sidebar: who is signed in, account, theme, shortcuts and sign out. */
export function UserMenu({
  user,
  role,
  compact = false,
}: {
  user: { name: string; email: string };
  role: string;
  /** Collapsed sidebar: avatar only. */
  compact?: boolean;
}) {
  const { theme, setTheme, openShortcuts } = useShell();
  const signOut = useSignOut();

  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "hover:bg-sidebar-accent data-[popup-open]:bg-sidebar-accent focus-visible:outline-ring flex w-full items-center gap-2 rounded-md p-1.5 text-left focus-visible:outline-2",
          compact && "justify-center",
        )}
      >
        <span className="sr-only">Account menu: </span>
        <span
          aria-hidden="true"
          className="bg-brand-subtle text-brand-strong inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
        >
          {initials(user.name)}
        </span>
        <span className={cn("min-w-0 flex-1", compact && "sr-only")}>
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="text-muted-foreground block truncate text-xs">
            <span className="sr-only">Your role: </span>
            <span className="capitalize">{role}</span>
          </span>
        </span>
        {!compact && <ChevronsUpDown aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6} className="z-[60] outline-none">
          <Menu.Popup className="glass text-popover-foreground w-64 origin-[var(--transform-origin)] rounded-lg border p-1 shadow-lg transition-[opacity,scale] duration-150 outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
            <Menu.Group>
              <Menu.GroupLabel className={cn(LABEL, "truncate")}>
                Signed in as <span className="text-foreground">{user.email}</span>
              </Menu.GroupLabel>
              {/* Next.js navigates without a page load, so the menu must close itself. */}
              <Menu.LinkItem render={<Link href="/app/account" />} closeOnClick className={ITEM}>
                <CircleUser aria-hidden="true" />
                Account
              </Menu.LinkItem>
            </Menu.Group>
            <Menu.Separator className="bg-border -mx-1 my-1 h-px" />
            <Menu.RadioGroup
              value={theme}
              onValueChange={(value) => setTheme(parseThemePreference(String(value)))}
            >
              <Menu.GroupLabel className={LABEL}>Theme</Menu.GroupLabel>
              {THEME_OPTIONS.map(({ value, label, Icon }) => (
                <Menu.RadioItem key={value} value={value} closeOnClick={false} className={ITEM}>
                  <Icon aria-hidden="true" />
                  {label}
                  <Menu.RadioItemIndicator className="text-brand-strong ml-auto">
                    <Check aria-hidden="true" className="size-4" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Separator className="bg-border -mx-1 my-1 h-px" />
            <Menu.Item onClick={openShortcuts} className={ITEM}>
              <Keyboard aria-hidden="true" />
              Keyboard shortcuts
              <Kbd aria-hidden="true" className="ml-auto">
                ?
              </Kbd>
            </Menu.Item>
            <Menu.Item onClick={() => void signOut()} className={ITEM}>
              <LogOut aria-hidden="true" />
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
