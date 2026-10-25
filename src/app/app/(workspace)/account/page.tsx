import type { Metadata } from "next";
import { headers } from "next/headers";
import { PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { initials } from "@/lib/initials";
import { relativeAge } from "@/lib/relative-time";
import { describeDevice } from "@/lib/user-agent";
import { getAuth } from "@/server/platform/auth";
import { requireAppWorkspace } from "../workspace-context";
import { AppearanceForm } from "./appearance-form";
import { ChangePasswordForm } from "./change-password-form";
import { type SessionRow, SessionsList } from "./sessions-list";

export const metadata: Metadata = { title: "Account" };

type ListedSession = Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["listSessions"]>>[number];

/** This device first, then newest. Times are worked out here so server and browser agree. */
function sessionRows(sessions: ListedSession[], currentId: string): SessionRow[] {
  const now = Date.now();
  return sessions
    .map((s) => {
      const device = describeDevice(s.userAgent);
      return {
        token: s.token,
        device: device.label,
        mobile: device.mobile,
        signedIn: `Signed in ${relativeAge(new Date(s.createdAt), now).long}`,
        ends: formatDate(new Date(s.expiresAt)),
        ip: s.ipAddress ?? null,
        current: s.id === currentId,
        createdAt: new Date(s.createdAt).getTime(),
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || b.createdAt - a.createdAt)
    .map(({ createdAt: _createdAt, ...row }) => row);
}

export default async function AccountPage() {
  const { ctx } = await requireAppWorkspace();
  const sessions = await getAuth().api.listSessions({ headers: await headers() });
  const rows = sessionRows(sessions, ctx.sessionId);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Account" description="Your sign-in details and preferences on this device." />

      <Section id="profile" title="Profile">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="bg-brand-subtle text-brand-strong inline-flex size-12 shrink-0 items-center justify-center rounded-full text-base font-semibold"
          >
            {initials(ctx.user.name)}
          </span>
          <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{ctx.user.name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium break-all">{ctx.user.email}</dd>
            <dt className="text-muted-foreground">Role in {ctx.workspace.name}</dt>
            <dd>
              <Badge variant="secondary">{ctx.role}</Badge>
            </dd>
          </dl>
        </div>
      </Section>

      <Section
        id="appearance"
        title="Appearance"
        description="Saved in this browser. You can also switch from the account menu or the command palette."
      >
        <AppearanceForm />
      </Section>

      <Section
        id="password"
        title="Change password"
        description="Changing your password signs you out everywhere else."
      >
        <ChangePasswordForm />
      </Section>

      <Section
        id="sessions"
        title="Where you're signed in"
        description="Each sign-in lasts 7 days. Sign out any device you don't recognise, then change your password."
        bodyClassName="p-0"
      >
        <SessionsList sessions={rows} />
      </Section>
    </div>
  );
}
