import { MailPlus } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { EmptyState, PageHeader, Section } from "@/components/page";
import { TableScroll } from "@/components/table-scroll";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/initials";
import { getMembersPage } from "@/server/modules/workspaces/service";
import { requireAppWorkspace } from "../workspace-context";
import { InvitationRow, InviteForm, MemberActions } from "./member-controls";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Members" };

const ROLE_BADGE: Record<string, string> = {
  owner: "",
  admin: "bg-brand-subtle text-brand-strong",
  agent: "",
};

export default async function MembersPage() {
  await requireAppWorkspace(); // resolve the active workspace first (shared with the layout)
  const { ctx, canManage, canInvite, members, invitations } = await getMembersPage(await headers());
  const memberCount = `${members.length} ${members.length === 1 ? "person" : "people"}`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Members"
        description={`People with access to ${ctx.workspace.name}. Owners and admins manage the team; agents work on tickets.`}
      />

      {canInvite && (
        <Section
          id="invite"
          title="Invite a teammate"
          description="Email delivery arrives in a later milestone. For now, copy the link and send it yourself. Links expire after 7 days and work once, for the invited email address only."
        >
          <InviteForm />
        </Section>
      )}

      <Section id="team" title="Team" description={memberCount} bodyClassName="p-0">
        <TableScroll label="Team members" className="rounded-t-none rounded-b-xl border-0">
          <table className="w-full text-sm">
            <caption className="sr-only">Workspace members and their roles</caption>
            <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                  Role
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                  Joined
                </th>
                {canManage && (
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.memberId} className="border-t">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="bg-muted text-muted-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                      >
                        {initials(m.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium">
                          {m.name}
                          {m.userId === ctx.user.id && <span className="text-muted-foreground"> (you)</span>}
                        </div>
                        <div className="text-muted-foreground [overflow-wrap:anywhere]">
                          {/* Prefer breaking before the @; anywhere else only if a part is too long. */}
                          {m.email.split("@")[0]}
                          {m.email.includes("@") && (
                            <>
                              <wbr />@{m.email.slice(m.email.indexOf("@") + 1)}
                            </>
                          )}
                        </div>
                        {/* Phones: the role sits under the email, so the name column keeps its width. */}
                        <Badge
                          variant={m.role === "owner" ? "default" : "secondary"}
                          className={cn("mt-1.5 sm:hidden", ROLE_BADGE[m.role])}
                        >
                          {m.role}
                        </Badge>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <Badge
                      variant={m.role === "owner" ? "default" : "secondary"}
                      className={ROLE_BADGE[m.role]}
                    >
                      {m.role}
                    </Badge>
                  </td>
                  <td className="text-muted-foreground hidden px-4 py-3 whitespace-nowrap sm:table-cell">
                    {formatDate(m.joinedAt)}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      {m.role !== "owner" && m.userId !== ctx.user.id && (
                        <MemberActions memberId={m.memberId} name={m.name} role={m.role} />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Section>

      {canInvite && (
        <Section
          id="invites"
          title="Pending invitations"
          description={
            invitations.length === 0
              ? "Nobody is waiting to join."
              : `${invitations.length} waiting to be accepted`
          }
          bodyClassName={invitations.length === 0 ? undefined : "p-0"}
        >
          {invitations.length === 0 ? (
            <EmptyState icon={MailPlus} title="No pending invitations" className="border-0 py-6">
              Invite links you create above appear here until they are used, cancelled or expire.
            </EmptyState>
          ) : (
            <ul className="flex flex-col divide-y">
              {invitations.map((i) => (
                <InvitationRow
                  key={i.id}
                  id={i.id}
                  email={i.email}
                  role={i.role ?? "agent"}
                  expires={formatDate(i.expiresAt)}
                />
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}
