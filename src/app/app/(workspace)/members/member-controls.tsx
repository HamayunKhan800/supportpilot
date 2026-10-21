"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { INVITABLE_ROLES } from "@/server/platform/auth/permissions";

const selectClass = "h-10 rounded-md border border-input bg-background px-2 text-sm";

function inviteLink(id: string) {
  return `${window.location.origin}/invite/${id}`;
}

export function InviteForm() {
  const router = useRouter();
  const roleId = useId();
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setError("");
    setLink("");
    setPending(true);
    const { data, error: err } = await authClient.organization.inviteMember({
      email: String(form.get("email")).trim(),
      role: String(form.get("role")) as (typeof INVITABLE_ROLES)[number],
      resend: true,
    });
    setPending(false);
    if (err || !data) {
      setError(authErrorMessage(err));
      return;
    }
    formEl.reset();
    setLink(inviteLink(data.id));
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Invite a teammate</h2>
        </CardTitle>
        <CardDescription>
          Email delivery arrives in a later milestone. For now, copy the link and send it yourself. Links
          expire after 7 days and work once, for the invited email address only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <FormField label="Email" name="email" type="email" autoComplete="off" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={roleId}>Role</Label>
            <select id={roleId} name="role" defaultValue="agent" className={selectClass}>
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" size="lg" className="h-10" disabled={pending}>
            {pending ? "Inviting…" : "Create invite link"}
          </Button>
        </form>
        <div className="mt-4 flex flex-col gap-3">
          <FormAlert message={error} />
          {link && <CopyLink link={link} />}
        </div>
      </CardContent>
    </Card>
  );
}

function CopyLink({ link }: { link: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5" role="status">
      <Label htmlFor={id}>Invitation link created</Label>
      <div className="flex gap-2">
        <input id={id} readOnly value={link} className={`${selectClass} flex-1 font-mono text-xs`} />
        <Button
          type="button"
          variant="outline"
          className="h-10"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export function MemberActions({ memberId, name, role }: { memberId: string; name: string; role: string }) {
  const router = useRouter();
  const id = useId();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<{ error: unknown }>) {
    setError("");
    setPending(true);
    const { error: err } = await action();
    setPending(false);
    if (err) setError(authErrorMessage(err as never));
    else router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center justify-end gap-2">
        <label htmlFor={id} className="sr-only">
          Role for {name}
        </label>
        <select
          id={id}
          defaultValue={role}
          disabled={pending}
          className={selectClass}
          onChange={(e) =>
            run(() =>
              authClient.organization.updateMemberRole({
                memberId,
                role: e.target.value as (typeof INVITABLE_ROLES)[number],
              }),
            )
          }
        >
          {INVITABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <Button
          variant="destructive"
          className="h-10"
          disabled={pending}
          aria-label={`Remove ${name}`}
          onClick={() => {
            if (window.confirm(`Remove ${name} from this workspace?`)) {
              void run(() => authClient.organization.removeMember({ memberIdOrEmail: memberId }));
            }
          }}
        >
          Remove
        </Button>
      </div>
      <FormAlert message={error} />
    </div>
  );
}

export function InvitationRow({
  id,
  email,
  role,
  expires,
}: {
  id: string;
  email: string;
  role: string;
  expires: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <div>
        <div className="font-medium">{email}</div>
        <div className="text-muted-foreground">
          {role} · expires {expires}
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="h-10"
          aria-label={`Copy invitation link for ${email}`}
          onClick={async () => {
            await navigator.clipboard.writeText(inviteLink(id));
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button
          variant="ghost"
          className="h-10"
          disabled={pending}
          aria-label={`Cancel invitation for ${email}`}
          onClick={async () => {
            setPending(true);
            await authClient.organization.cancelInvitation({ invitationId: id });
            router.refresh();
          }}
        >
          Cancel
        </Button>
      </div>
    </li>
  );
}
