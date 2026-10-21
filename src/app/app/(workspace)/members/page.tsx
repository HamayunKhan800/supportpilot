import type { Metadata } from "next";
import { headers } from "next/headers";
import { Badge } from "@/components/ui/badge";
import { requireAppWorkspace } from "../workspace-context";
import { getMembersPage } from "@/server/modules/workspaces/service";
import { InvitationRow, InviteForm, MemberActions } from "./member-controls";

export const metadata: Metadata = { title: "Members" };

const dateFmt = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export default async function MembersPage() {
  await requireAppWorkspace(); // resolve the active workspace first (shared with the layout)
  const { ctx, canManage, canInvite, members, invitations } = await getMembersPage(await headers());
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-muted-foreground">People with access to {ctx.workspace.name}.</p>
      </div>

      {canInvite && <InviteForm />}

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="text-lg font-semibold">
          Team ({members.length})
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Workspace members and their roles</caption>
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
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
                    <div className="font-medium">
                      {m.name}
                      {m.userId === ctx.user.id && <span className="text-muted-foreground"> (you)</span>}
                    </div>
                    <div className="text-muted-foreground">{m.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={m.role === "owner" ? "default" : "secondary"}>{m.role}</Badge>
                  </td>
                  <td className="text-muted-foreground hidden px-4 py-3 sm:table-cell">
                    {dateFmt.format(m.joinedAt)}
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
        </div>
      </section>

      {canInvite && (
        <section aria-labelledby="invites-heading" className="flex flex-col gap-3">
          <h2 id="invites-heading" className="text-lg font-semibold">
            Pending invitations ({invitations.length})
          </h2>
          {invitations.length === 0 ? (
            <p className="text-muted-foreground text-sm">No pending invitations.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {invitations.map((i) => (
                <InvitationRow
                  key={i.id}
                  id={i.id}
                  email={i.email}
                  role={i.role ?? "agent"}
                  expires={dateFmt.format(i.expiresAt)}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
