import { cookies, headers } from "next/headers";
import type { NavItem } from "@/lib/navigation";
import { parseSidebarCollapsed, SIDEBAR_COOKIE } from "@/lib/sidebar";
import { parseThemePreference, THEME_COOKIE } from "@/lib/theme";
import { isReviewer } from "@/server/modules/eval-review/service";
import { getTicketCounts } from "@/server/modules/tickets/service";
import { can } from "@/server/platform/auth/permissions";
import { ShellProvider } from "./shell/shell-context";
import { DesktopSidebar, MobileHeader, type SidebarProps } from "./shell/sidebar";
import { requireAppWorkspace } from "./workspace-context";

/**
 * Every page below requires a session and a verified workspace membership.
 * App shell (design system step 2): sidebar on wide screens, a top bar with a drawer on
 * narrow ones, a user menu, the Ctrl/⌘ K command palette and a "?" shortcut sheet.
 * Links appear only for roles that may open them; the pages still check on their own.
 */
export default async function WorkspaceLayout({ children }: LayoutProps<"/app">) {
  const { ctx, memberships } = await requireAppWorkspace();
  const jar = await cookies();
  const theme = parseThemePreference(jar.get(THEME_COOKIE)?.value);
  const collapsed = parseSidebarCollapsed(jar.get(SIDEBAR_COOKIE)?.value);
  const openTickets = can(ctx.role, { ticket: ["read"] })
    ? (await getTicketCounts(await headers())).open
    : undefined;

  const analytics = can(ctx.role, { analytics: ["read"] });
  const items: NavItem[] = [
    { href: "/app", label: "Overview", icon: "overview", keywords: "home dashboard" },
    {
      href: "/app/tickets",
      label: "Tickets",
      icon: "tickets",
      group: "work",
      badge: openTickets,
      keywords: "inbox requests conversations",
    },
    ...(can(ctx.role, { kb: ["read"] })
      ? [
          {
            href: "/app/knowledge",
            label: "Knowledge",
            icon: "knowledge",
            group: "work",
            keywords: "help articles documents search",
          } as const,
        ]
      : []),
    ...(analytics
      ? [
          {
            href: "/app/analytics",
            label: "Analytics",
            icon: "analytics",
            group: "insights",
            keywords: "usage reports charts",
          } as const,
          {
            href: "/app/analytics/evaluation",
            label: "Evaluation",
            icon: "evaluation",
            group: "insights",
            keywords: "ai quality accuracy eval",
          } as const,
        ]
      : []),
    {
      href: "/app/members",
      label: "Members",
      icon: "members",
      group: "admin",
      keywords: "team invite people",
    },
    ...(can(ctx.role, { settings: ["read"] })
      ? [
          {
            href: "/app/settings",
            label: "AI settings",
            icon: "settings",
            group: "admin",
            keywords: "model budget categories",
          } as const,
        ]
      : []),
    ...(can(ctx.role, { audit: ["read"] })
      ? [
          {
            href: "/app/audit",
            label: "Audit log",
            icon: "audit",
            group: "admin",
            keywords: "history security",
          } as const,
        ]
      : []),
    // The evaluation Review page: only for the reviewers named in EVAL_REVIEWER_EMAILS (M6 D2).
    ...(isReviewer(ctx.user.email)
      ? [
          {
            href: "/app/review",
            label: "Review",
            icon: "review",
            group: "admin",
            keywords: "verdicts labels",
          } as const,
        ]
      : []),
  ];

  const shell: SidebarProps = {
    items,
    workspace: { id: ctx.workspace.id, name: ctx.workspace.name },
    memberships,
    user: { name: ctx.user.name, email: ctx.user.email },
    role: ctx.role,
  };

  return (
    <ShellProvider items={items} initialTheme={theme} initialCollapsed={collapsed}>
      <div className="flex min-h-svh flex-1">
        <DesktopSidebar {...shell} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileHeader {...shell} />
          <main
            id="main"
            className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 has-[[data-wide]]:max-w-7xl sm:px-6 lg:px-10 has-[[data-wide=xl]]:2xl:max-w-[100rem]"
          >
            {children}
          </main>
        </div>
      </div>
    </ShellProvider>
  );
}
