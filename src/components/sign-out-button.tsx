"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useProgressRouter } from "@/lib/use-progress-router";

export function SignOutButton() {
  const router = useProgressRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      pending={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
