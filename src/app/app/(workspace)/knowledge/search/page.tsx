import type { Metadata } from "next";
import Link from "next/link";
import { Forbidden } from "@/components/forbidden";
import { can } from "@/server/platform/auth/permissions";
import { requireAppWorkspace } from "../../workspace-context";
import { SearchPanel } from "./search-panel";

export const metadata: Metadata = { title: "Test search" };

export default async function TestSearchPage() {
  const { ctx } = await requireAppWorkspace();
  // Each search spends embedding quota, so it is limited to admins and owners (docs/01 §2.1).
  if (!can(ctx.role, { kb: ["write"] })) return <Forbidden what="knowledge-base test search" />;
  return (
    <div className="flex flex-col gap-6">
      <Link href="/app/knowledge" className="text-sm underline">
        ← Knowledge base
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Test search</h1>
        <p className="text-muted-foreground">
          Ask a question the way a customer would, and see which passages an AI draft would be given. Two
          searches run side by side: one by meaning and one by keywords. Their rankings are combined
          (Reciprocal Rank Fusion) and the top 5 passages are shown.
        </p>
      </div>
      <SearchPanel />
    </div>
  );
}
