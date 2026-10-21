"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { authClient } from "@/lib/auth-client";

interface Props {
  activeId: string;
  workspaces: { workspaceId: string; name: string }[];
}

/** Native <select>: accessible by default and needs no inline styles (strict CSP). */
export function WorkspaceSwitcher({ activeId, workspaces }: Props) {
  const router = useRouter();
  const id = useId();
  const [pending, setPending] = useState(false);
  if (workspaces.length < 2) {
    return <span className="font-medium">{workspaces[0]?.name}</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Active workspace
      </label>
      <select
        id={id}
        value={activeId}
        disabled={pending}
        className="border-input bg-background h-9 rounded-md border px-2 text-sm font-medium"
        onChange={async (e) => {
          setPending(true);
          await authClient.organization.setActive({ organizationId: e.target.value });
          setPending(false);
          router.refresh();
        }}
      >
        {workspaces.map((w) => (
          <option key={w.workspaceId} value={w.workspaceId}>
            {w.name}
          </option>
        ))}
      </select>
    </div>
  );
}
