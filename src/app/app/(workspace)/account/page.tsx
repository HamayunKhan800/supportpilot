import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/initials";
import { requireAppWorkspace } from "../workspace-context";
import { AppearanceForm } from "./appearance-form";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const { ctx } = await requireAppWorkspace();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title="Account" description="Your sign-in details and preferences on this device." />

      <Section id="profile" title="Profile">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="bg-brand-subtle text-brand-strong inline-flex size-12 shrink-0 items-center justify-center rounded-full text-base font-semibold"
          >
            {initials(ctx.user.name)}
          </span>
          <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{ctx.user.name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium break-all">{ctx.user.email}</dd>
            <dt className="text-muted-foreground">Role in {ctx.workspace.name}</dt>
            <dd>
              <Badge variant="secondary">{ctx.role}</Badge>
            </dd>
          </dl>
        </div>
      </Section>

      <Section
        id="appearance"
        title="Appearance"
        description="Saved in this browser. You can also switch from the account menu or the command palette."
      >
        <AppearanceForm />
      </Section>

      <Section
        id="password"
        title="Change password"
        description="Changing your password signs you out everywhere else."
      >
        <ChangePasswordForm />
      </Section>
    </div>
  );
}
