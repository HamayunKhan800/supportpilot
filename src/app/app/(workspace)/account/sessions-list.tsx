"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { notify } from "@/lib/toast";

export interface SessionRow {
  /**
   * Better Auth's revoke endpoint takes the session token. It can't sign anyone in on its own:
   * the session cookie also needs the server's signature (tested in tests/integration/auth.test.ts).
   */
  token: string;
  device: string;
  mobile: boolean;
  /** "Signed in 2 hours ago", worked out on the server so both renders match. */
  signedIn: string;
  ends: string;
  ip: string | null;
  current: boolean;
}

/** Where this account is signed in, with sign-out per device (M7-05, ASVS V7.5.2). */
export function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const others = sessions.filter((s) => !s.current);
  const focusHeading = () => document.getElementById("sessions-heading");

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col divide-y" aria-label="Signed-in devices">
        {sessions.map((s) => {
          const Icon = s.mobile ? Smartphone : Monitor;
          return (
            <li key={s.token} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <Icon aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {s.device}
                    {s.current && <Badge variant="secondary">This device</Badge>}
                  </div>
                  <div className="text-muted-foreground">
                    {s.signedIn}
                    {s.ip && <> · {s.ip}</>} · ends {s.ends}
                  </div>
                </div>
              </div>
              {!s.current && (
                <ConfirmDialog
                  trigger={<Button variant="ghost" className="h-10" aria-label={`Sign out ${s.device}`} />}
                  triggerLabel="Sign out"
                  title="Sign out this device?"
                  description={
                    <>
                      <span className="text-foreground font-medium">{s.device}</span> will need your password
                      to get back in.
                    </>
                  }
                  cancelLabel="Keep signed in"
                  confirmLabel="Sign out device"
                  focusAfterConfirm={focusHeading}
                  onConfirm={async () => {
                    const { error } = await authClient.revokeSession({ token: s.token });
                    if (error) return authErrorMessage(error);
                    notify("Device signed out", { description: s.device });
                    router.refresh();
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      {others.length > 0 && (
        <div className="border-t px-4 py-3">
          <ConfirmDialog
            trigger={<Button variant="outline" className="h-10" />}
            triggerLabel="Sign out all other devices"
            title="Sign out everywhere else?"
            description="Every other device will need your password to get back in. This one stays signed in."
            cancelLabel="Keep them"
            confirmLabel="Sign out others"
            focusAfterConfirm={focusHeading}
            onConfirm={async () => {
              const { error } = await authClient.revokeOtherSessions();
              if (error) return authErrorMessage(error);
              notify(others.length === 1 ? "1 device signed out" : `${others.length} devices signed out`);
              router.refresh();
            }}
          />
        </div>
      )}
    </div>
  );
}
