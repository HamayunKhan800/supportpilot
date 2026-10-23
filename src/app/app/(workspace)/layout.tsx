import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { isReviewer } from "@/server/modules/eval-review/service";
import { can } from "@/server/platform/auth/permissions";
import { NavLinks } from "./nav-links";
import { requireAppWorkspace } from "./workspace-context";
import { WorkspaceSwitcher } from "./workspace-switcher";

/** Every page below requires a session and a verified workspace membership. */
export default async function WorkspaceLayout({ children }: LayoutProps<"/app">) {
  const { ctx, memberships } = await requireAppWorkspace();

  const links = [
    { href: "/app", label: "Overview" },
    { href: "/app/tickets", label: "Tickets" },
    ...(can(ctx.role, { kb: ["read"] }) ? [{ href: "/app/knowledge", label: "Knowledge" }] : []),
    { href: "/app/members", label: "Members" },
    ...(can(ctx.role, { settings: ["read"] }) ? [{ href: "/app/settings", label: "AI settings" }] : []),
    ...(can(ctx.role, { audit: ["read"] }) ? [{ href: "/app/audit", label: "Audit log" }] : []),
    // The evaluation Review page: only for the reviewers named in EVAL_REVIEWER_EMAILS (M6 D2).
    ...(isReviewer(ctx.user.email) ? [{ href: "/app/review", label: "Review" }] : []),
    { href: "/app/account", label: "Account" },
  ];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/app" className="font-semibold tracking-tight">
              SupportPilot
            </Link>
            <span aria-hidden="true" className="text-muted-foreground">
              /
            </span>
            <WorkspaceSwitcher activeId={ctx.workspace.id} workspaces={memberships} />
            <Badge variant="secondary">
              <span className="sr-only">Your role: </span>
              {ctx.role}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground hidden text-sm sm:inline">{ctx.user.email}</span>
            <SignOutButton />
          </div>
        </div>
        <nav aria-label="Workspace" className="mx-auto w-full max-w-5xl px-4 pb-2">
          <NavLinks links={links} />
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
