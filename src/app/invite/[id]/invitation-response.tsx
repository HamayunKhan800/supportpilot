"use client";

import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { useProgressRouter } from "@/lib/use-progress-router";

export function InvitationResponse({
  invitationId,
  workspaceId,
}: {
  invitationId: string;
  workspaceId: string;
}) {
  const router = useProgressRouter();
  const [error, setError] = useState("");
  const [declined, setDeclined] = useState(false);
  const [pending, setPending] = useState<null | "accept" | "decline">(null);

  if (declined) return <FormAlert message="Invitation declined." tone="success" />;

  return (
    <div className="flex flex-col gap-3">
      <FormAlert message={error} />
      <div className="flex gap-2">
        <Button
          size="lg"
          disabled={pending !== null}
          pending={pending === "accept"}
          onClick={async () => {
            setPending("accept");
            const { error: err } = await authClient.organization.acceptInvitation({ invitationId });
            if (err) {
              setPending(null);
              setError(authErrorMessage(err));
              return;
            }
            await authClient.organization.setActive({ organizationId: workspaceId });
            router.replace("/app");
            router.refresh();
          }}
        >
          {pending === "accept" ? "Accepting…" : "Accept invitation"}
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={pending !== null}
          pending={pending === "decline"}
          onClick={async () => {
            setPending("decline");
            const { error: err } = await authClient.organization.rejectInvitation({ invitationId });
            setPending(null);
            if (err) setError(authErrorMessage(err));
            else setDeclined(true);
          }}
        >
          {pending === "decline" ? "Declining…" : "Decline"}
        </Button>
      </div>
    </div>
  );
}
