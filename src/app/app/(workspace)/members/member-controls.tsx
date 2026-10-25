"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { notify } from "@/lib/toast";
import { INVITABLE_ROLES } from "@/server/platform/auth/permissions";

const selectClass = "field-focus h-10 rounded-md border border-input bg-background px-2 text-sm";

function inviteLink(id: string) {
  return `${window.location.origin}/invite/${id}`;
}

/** Copies text; the clipboard API needs a secure context, so failure is reported, not thrown. */
async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify(`${what} copied`);
    return true;
  } catch {
    notify("Couldn't copy the link", {
      tone: "error",
      description: "Select the link and copy it yourself.",
    });
    return false;
  }
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
    <div className="flex flex-col gap-4">
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
        <Button type="submit" size="lg" className="h-10" pending={pending}>
          {pending ? "Inviting…" : "Create invite link"}
        </Button>
      </form>
      <FormAlert message={error} />
      {link && <CopyLink link={link} />}
    </div>
  );
}

function CopyLink({ link }: { link: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-muted/50 flex flex-col gap-1.5 rounded-lg border p-3" role="status">
      <Label htmlFor={id}>Invitation link created</Label>
      <div className="flex gap-2">
        <input id={id} readOnly value={link} className={`${selectClass} min-w-0 flex-1 font-mono text-xs`} />
        <Button
          type="button"
          variant="outline"
          className="h-10"
          onClick={async () => setCopied(await copy(link, "Invitation link"))}
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
  const [current, setCurrent] = useState(role);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function changeRole(next: string) {
    const previous = current;
    setCurrent(next);
    setError("");
    setPending(true);
    const { error: err } = await authClient.organization.updateMemberRole({
      memberId,
      role: next as (typeof INVITABLE_ROLES)[number],
    });
    setPending(false);
    if (err) {
      setCurrent(previous); // the change didn't happen; show the role they still have
      setError(authErrorMessage(err));
      return;
    }
    notify(`${name} is now an ${next}`); // the invitable roles are "admin" and "agent"
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center justify-end gap-2">
        <label htmlFor={id} className="sr-only">
          Role for {name}
        </label>
        <select
          id={id}
          value={current}
          disabled={pending}
          className={selectClass}
          onChange={(e) => void changeRole(e.target.value)}
        >
          {INVITABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <ConfirmDialog
          trigger={
            <Button variant="destructive" className="h-10" disabled={pending} aria-label={`Remove ${name}`} />
          }
          triggerLabel="Remove"
          title={`Remove ${name}?`}
          description="They lose access to this workspace straight away. You can invite them again later."
          confirmLabel="Remove member"
          onConfirm={async () => {
            const { error: err } = await authClient.organization.removeMember({ memberIdOrEmail: memberId });
            if (err) return authErrorMessage(err);
            notify(`Removed ${name}`);
            router.refresh();
          }}
          focusAfterConfirm={() => document.getElementById("team-heading")}
        />
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
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <div className="font-medium break-all">{email}</div>
        <div className="text-muted-foreground">
          {role} · expires {expires}
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="h-10"
          aria-label={`Copy invitation link for ${email}`}
          onClick={async () => setCopied(await copy(inviteLink(id), "Invitation link"))}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
        <ConfirmDialog
          trigger={<Button variant="ghost" className="h-10" aria-label={`Cancel invitation for ${email}`} />}
          triggerLabel="Cancel"
          title="Cancel this invitation?"
          description={
            <>
              The link for <span className="text-foreground font-medium break-all">{email}</span> stops
              working straight away. You can create a new one later.
            </>
          }
          cancelLabel="Keep invitation"
          confirmLabel="Cancel invitation"
          onConfirm={async () => {
            const { error: err } = await authClient.organization.cancelInvitation({ invitationId: id });
            if (err) return authErrorMessage(err);
            notify("Invitation cancelled", { description: email });
            router.refresh();
          }}
          focusAfterConfirm={() => document.getElementById("invites-heading")}
        />
      </div>
    </li>
  );
}
