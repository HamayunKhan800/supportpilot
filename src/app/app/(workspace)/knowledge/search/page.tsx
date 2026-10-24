import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/page";
import { MOCK_SIMILARITY_FLOOR } from "@/server/modules/kb/embedder";
import { getAiSettings } from "@/server/modules/settings/service";
import { can } from "@/server/platform/auth/permissions";
import { requireAppWorkspace } from "../../workspace-context";
import { SearchPanel } from "./search-panel";

export const metadata: Metadata = { title: "Test search" };

export default async function TestSearchPage() {
  const { ctx } = await requireAppWorkspace();
  // Each search spends embedding quota, so it is limited to admins and owners (docs/01 §2.1).
  if (!can(ctx.role, { kb: ["write"] })) return <Forbidden what="knowledge-base test search" />;
  const { settings } = await getAiSettings(await headers());
  // The floor drafts actually use: the workspace setting with Gemini, a fixed one offline (finding #89).
  const floor = settings.retrievalMinScoreApplies
    ? { value: settings.retrievalMinScore, source: "workspace" as const }
    : { value: MOCK_SIMILARITY_FLOOR, source: "mock" as const };
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/app/knowledge"
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Knowledge base
      </Link>
      <PageHeader
        title="Test search"
        description="Ask a question the way a customer would, and see which passages an AI draft would be given. The top 5 passages are ranked by meaning. A keyword search also runs, and its badge shows where it would have ranked each passage."
      />
      <SearchPanel floor={floor} />
    </div>
  );
}
