"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { activeHref, groupNav, NAV_GROUP_LABEL, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "../workspace-switcher";
import { LogoMark, ModKey, NAV_ICON } from "./parts";
import { useShell } from "./shell-context";
import { UserMenu } from "./user-menu";

export interface SidebarProps {
  items: NavItem[];
  workspace: { id: string; name: string };
  memberships: { workspaceId: string; name: string }[];
  user: { name: string; email: string };
  role: string;
}

const ICON_BUTTON =
  "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-ring inline-flex size-8 shrink-0 items-center justify-center rounded-md focus-visible:outline-2";

/** Wide screens: a sticky sidebar that collapses to icons (button or "["). */
export function DesktopSidebar(props: SidebarProps) {
  const { collapsed } = useShell();
  return (
    <div
      className={cn(
        "bg-sidebar text-sidebar-foreground border-sidebar-border sticky top-0 hidden h-svh shrink-0 flex-col border-r transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <SidebarBody {...props} compact={collapsed} />
    </div>
  );
}

/** Narrow screens: a top bar with a menu button that opens the same sidebar as a drawer. */
export function MobileHeader(props: SidebarProps) {
  const [open, setOpen] = useState(false);
  const { openPalette } = useShell();
  return (
    <header className="bg-background/95 border-border sticky top-0 z-40 flex h-14 items-center gap-2 border-b px-2 backdrop-blur lg:hidden">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className={cn(ICON_BUTTON, "size-10")}>
          <MenuIcon aria-hidden="true" className="size-5" />
          <span className="sr-only">Open navigation</span>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="bg-background/70 fixed inset-0 z-50 backdrop-blur-[2px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
          <Dialog.Popup className="bg-sidebar text-sidebar-foreground border-sidebar-border fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r shadow-2xl transition-transform duration-200 ease-out outline-none data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full motion-reduce:transition-none">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <SidebarBody {...props} onNavigate={() => setOpen(false)} />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Link href="/app" className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1">
        <LogoMark />
        <span className="truncate text-sm font-semibold">{props.workspace.name}</span>
      </Link>
      <button type="button" onClick={openPalette} className={cn(ICON_BUTTON, "size-10")}>
        <Search aria-hidden="true" className="size-5" />
        <span className="sr-only">Search or jump to</span>
      </button>
    </header>
  );
}

function SidebarBody({
  items,
  workspace,
  memberships,
  user,
  role,
  compact = false,
  onNavigate,
}: SidebarProps & { compact?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { toggleSidebar, openPalette } = useShell();
  const current = activeHref(
    pathname,
    items.map((i) => i.href),
  );
  const inDrawer = Boolean(onNavigate);
  const id = useId();

  return (
    <>
      <div className={cn("flex h-14 shrink-0 items-center gap-2 px-3", compact && "justify-center px-0")}>
        {!compact && (
          <Link
            href="/app"
            onClick={onNavigate}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md"
          >
            <LogoMark />
            <span className="min-w-0">
              <span title={workspace.name} className="block truncate text-sm leading-tight font-semibold">
                {workspace.name}
              </span>
              <span className="text-muted-foreground block text-xs leading-tight">SupportPilot</span>
            </span>
          </Link>
        )}
        {inDrawer ? (
          <Dialog.Close className={ICON_BUTTON}>
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">Close navigation</span>
          </Dialog.Close>
        ) : (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={!compact}
            title={compact ? "Expand sidebar ( [ )" : "Collapse sidebar ( [ )"}
            className={ICON_BUTTON}
          >
            {compact ? (
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            )}
            <span className="sr-only">Sidebar</span>
          </button>
        )}
      </div>

      {!compact && memberships.length > 1 && (
        <div className="px-3 pb-2">
          <WorkspaceSwitcher activeId={workspace.id} workspaces={memberships} />
        </div>
      )}

      <div className={cn("px-3 pb-2", compact && "flex justify-center px-0")}>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            openPalette();
          }}
          className={cn(
            "border-sidebar-border bg-background text-muted-foreground hover:text-foreground focus-visible:outline-ring flex h-8 items-center gap-2 rounded-md border text-sm focus-visible:outline-2",
            compact ? "w-8 justify-center" : "w-full px-2",
          )}
        >
          <Search aria-hidden="true" className="size-4 shrink-0" />
          <span className={cn("flex-1 truncate text-left whitespace-nowrap", compact && "sr-only")}>
            Search<span className="sr-only"> or jump to</span>…
          </span>
          {!compact && !inDrawer && (
            <span aria-hidden="true" className="flex gap-0.5">
              <ModKey />
              <Kbd>K</Kbd>
            </span>
          )}
        </button>
      </div>

      {/* Collapsed: no scroll container, so the hover labels are not clipped. */}
      <nav
        aria-label="Workspace"
        className={cn("min-h-0 flex-1 px-2 py-1", compact ? "overflow-visible" : "overflow-y-auto")}
      >
        {groupNav(items).map(({ group, items: links }, g) => {
          const labelId = `${id}-${group ?? "top"}`;
          return (
            <div key={group ?? "top"} className={cn(g > 0 && "mt-4")}>
              {group &&
                (compact ? (
                  <div className="bg-sidebar-border mx-2 mb-2 h-px" />
                ) : (
                  <p id={labelId} className="text-muted-foreground px-2 pb-1 text-xs font-medium">
                    {NAV_GROUP_LABEL[group]}
                  </p>
                ))}
              <ul className="space-y-0.5" aria-labelledby={group && !compact ? labelId : undefined}>
                {links.map((item) => (
                  <SidebarLink
                    key={item.href}
                    item={item}
                    state={item.href === current ? (pathname === item.href ? "page" : "true") : undefined}
                    compact={compact}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-sidebar-border shrink-0 border-t p-2">
        <UserMenu user={user} role={role} compact={compact} />
      </div>
    </>
  );
}

function SidebarLink({
  item,
  state,
  compact,
  onNavigate,
}: {
  item: NavItem;
  /** aria-current: "page" on the page itself, "true" on its sub-pages. */
  state: "page" | "true" | undefined;
  compact: boolean;
  onNavigate?: () => void;
}) {
  const Icon = NAV_ICON[item.icon];
  const descId = useId();
  const hasBadge = item.badge !== undefined && item.badge > 0;
  return (
    <li className="group/link relative">
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={state}
        aria-describedby={hasBadge ? descId : undefined}
        className={cn(
          "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-ring flex h-8 items-center gap-2.5 rounded-md px-2 text-sm focus-visible:outline-2",
          state && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
          compact && "justify-center px-0",
        )}
      >
        <SidebarIcon Icon={Icon} active={Boolean(state)} />
        <span className={cn("truncate", compact && "sr-only")}>{item.label}</span>
        {hasBadge && !compact && (
          <span aria-hidden="true" className="text-muted-foreground ml-auto text-xs tabular-nums">
            {item.badge}
          </span>
        )}
      </Link>
      {hasBadge && (
        <span id={descId} hidden>
          {item.badge} open
        </span>
      )}
      {compact && (
        <span
          aria-hidden="true"
          className="bg-popover text-popover-foreground pointer-events-none absolute top-1/2 left-full z-50 ml-2 -translate-y-1/2 rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap opacity-0 shadow-md transition-opacity group-focus-within/link:opacity-100 group-hover/link:opacity-100 motion-reduce:transition-none"
        >
          {item.label}
        </span>
      )}
    </li>
  );
}

/** The link's icon; pulses while its page loads. useLinkStatus must sit inside the <Link>. */
function SidebarIcon({ Icon, active }: { Icon: (typeof NAV_ICON)[keyof typeof NAV_ICON]; active: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-4 shrink-0", active && "text-brand-strong", pending && "nav-link-pending")}
    />
  );
}
