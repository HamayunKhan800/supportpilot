"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      pending={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        // A full page load, not a client-side change: the router could still hold pages fetched while
        // signed in (a soft change to /sign-in sometimes stayed in the app until a refresh), and a
        // fresh load also clears everything the app kept in memory.
        window.location.replace("/sign-in");
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
