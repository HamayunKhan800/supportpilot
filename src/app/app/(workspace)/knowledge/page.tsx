import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { FormAlert } from "@/components/form-alert";
import { Badge } from "@/components/ui/badge";
import { ingestErrorMessage } from "@/server/modules/kb/ingest-errors";
import { listKbDocuments } from "@/server/modules/kb/service";
import { can } from "@/server/platform/auth/permissions";
import { dateFormat } from "../tickets/labels";
import { requireAppWorkspace } from "../workspace-context";
import { AutoRefresh } from "./auto-refresh";
import { formatBytes, isInProgress, STATUS_CLASS, STATUS_LABEL, typeLabel } from "./labels";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function KnowledgePage({ searchParams }: PageProps<"/app/knowledge">) {
  const { ctx } = await requireAppWorkspace();
  const manage = can(ctx.role, { kb: ["write"] });
  const { items, usage } = await listKbDocuments(await headers());
  const inProgress = items.filter((d) => isInProgress(d.status)).length;
  const deleted = (await searchParams).deleted === "1";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge base</h1>
          <p className="text-muted-foreground">
            Help articles that AI drafts will cite.{" "}
            {manage ? "Add, check and remove documents here." : "Only admins and owners can change them."}
          </p>
        </div>
        {manage && (
          <Link
            href="/app/knowledge/search"
            className="hover:bg-muted inline-flex h-10 items-center rounded-lg border px-4 text-sm font-medium"
          >
            Test search
          </Link>
        )}
      </div>

      {deleted && <FormAlert message="Document deleted." tone="success" />}
      {manage && <UploadForm />}

      <section aria-labelledby="documents-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="documents-heading" className="text-lg font-semibold">
            Documents
          </h2>
          <p className="text-muted-foreground text-sm tabular-nums">
            {usage.documentCount} of {usage.maxDocuments} documents · {formatBytes(usage.totalBytes)} of{" "}
            {formatBytes(usage.maxBytes)}
          </p>
        </div>
        <AutoRefresh inProgress={inProgress} />
        {items.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border p-6 text-sm">
            No documents yet.{manage ? " Upload your first help article above." : ""}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((d) => (
              <li
                key={d.id}
                className="hover:bg-muted/40 relative flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link
                    href={`/app/knowledge/${d.id}`}
                    className="truncate font-medium after:absolute after:inset-0 hover:underline"
                  >
                    {d.title}
                  </Link>
                  <span className="text-muted-foreground truncate text-sm">
                    {typeLabel(d.mimeType)} · {formatBytes(d.sizeBytes)}
                    {d.status === "ready" ? ` · ${d.chunkCount} passage${d.chunkCount === 1 ? "" : "s"}` : ""}
                  </span>
                  {d.status === "failed" && (
                    <span className="text-sm text-red-800">{ingestErrorMessage(d.errorCode)}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className={STATUS_CLASS[d.status]}>
                    <span className="sr-only">Status: </span>
                    {STATUS_LABEL[d.status]}
                  </Badge>
                  <span className="text-muted-foreground">
                    Added <time dateTime={d.createdAt.toISOString()}>{dateFormat.format(d.createdAt)}</time>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
