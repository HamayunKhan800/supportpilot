import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { getAppContext } from "@/server/modules/workspaces/service";
import { CreateWorkspaceForm } from "./create-workspace-form";

export const metadata: Metadata = { title: "Create a workspace" };

export default async function OnboardingPage() {
  const app = await getAppContext(await headers());
  if (app.status === "signed-out") redirect("/sign-in?next=/app/onboarding");
  const user = app.status === "ok" ? app.ctx.user : app.session.user;
  const { name, email } = user;
  return (
    <AuthShell>
      <CreateWorkspaceForm userName={name} hasWorkspace={app.status === "ok"} />
      <div className="text-muted-foreground mt-8 flex items-center justify-between gap-2 border-t pt-4 text-sm">
        <span className="min-w-0 truncate">Signed in as {email}</span>
        <SignOutButton />
      </div>
    </AuthShell>
  );
}
