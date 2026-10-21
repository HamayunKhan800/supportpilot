import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { getAppContext } from "@/server/modules/workspaces/service";
import { CreateWorkspaceForm } from "./create-workspace-form";

export const metadata: Metadata = { title: "Create a workspace" };

export default async function OnboardingPage() {
  const app = await getAppContext(await headers());
  if (app.status === "signed-out") redirect("/sign-in?next=/app/onboarding");
  const name = app.status === "ok" ? app.ctx.user.name : app.session.user.name;
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <div className="w-full max-w-md">
        <CreateWorkspaceForm userName={name} hasWorkspace={app.status === "ok"} />
      </div>
      <SignOutButton />
    </main>
  );
}
