import type { Metadata } from "next";
import { requireAppWorkspace } from "../workspace-context";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const { ctx } = await requireAppWorkspace();
  return (
    <div className="flex max-w-lg flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-muted-foreground">
          {ctx.user.name} · {ctx.user.email}
        </p>
      </div>
      <ChangePasswordForm />
    </div>
  );
}
