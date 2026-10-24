"use client";

import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { validateWorkspaceName, validateWorkspaceSlug } from "@/server/platform/auth/policy";
import { useProgressRouter } from "@/lib/use-progress-router";

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function CreateWorkspaceForm({ userName, hasWorkspace }: { userName: string; hasWorkspace: boolean }) {
  const router = useProgressRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; slug?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Same rules as the server (which enforces them regardless).
    const next = {
      name: validateWorkspaceName(name) ?? undefined,
      slug: validateWorkspaceSlug(slug) ?? undefined,
    };
    setErrors(next);
    if (next.name || next.slug) return;
    setPending(true);
    const { error } = await authClient.organization.create({ name: name.trim(), slug });
    if (error) {
      setPending(false);
      setErrors({ form: authErrorMessage(error) });
      return;
    }
    router.replace("/app");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          {hasWorkspace ? "Create another workspace" : `Welcome, ${userName}`}
        </h1>
        <p className="text-muted-foreground text-sm">
          A workspace holds your team, tickets and help articles. You can invite teammates once it exists.
        </p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormAlert message={errors.form ?? ""} />
        <FormField
          label="Workspace name"
          name="name"
          autoComplete="organization"
          required
          value={name}
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
        />
        <FormField
          label="Workspace address"
          name="slug"
          required
          value={slug}
          error={errors.slug}
          hint={
            slug
              ? `Your customer portal will be at /p/${slug}. Lowercase letters, numbers and hyphens.`
              : "Lowercase letters, numbers and hyphens. Used in your customer portal link."
          }
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value);
          }}
        />
        <Button type="submit" size="lg" className="h-10" disabled={pending}>
          {pending ? "Creating…" : "Create workspace"}
        </Button>
      </form>
    </div>
  );
}
