"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function InvitationResponse({
  invitationId,
  workspaceId,
}: {
  invitationId: string;
  workspaceId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [declined, setDeclined] = useState(false);
  const [pending, setPending] = useState(false);

  if (declined) return <FormAlert message="Invitation declined." tone="success" />;

  return (
    <div className="flex flex-col gap-3">
      <FormAlert message={error} />
      <div className="flex gap-2">
        <Button
          size="lg"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const { error: err } = await authClient.organization.acceptInvitation({ invitationId });
            if (err) {
              setPending(false);
              setError(authErrorMessage(err));
              return;
            }
            await authClient.organization.setActive({ organizationId: workspaceId });
            router.replace("/app");
            router.refresh();
          }}
        >
          Accept invitation
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const { error: err } = await authClient.organization.rejectInvitation({ invitationId });
            setPending(false);
            if (err) setError(authErrorMessage(err));
            else setDeclined(true);
          }}
        >
          Decline
        </Button>
      </div>
    </div>
  );
}
