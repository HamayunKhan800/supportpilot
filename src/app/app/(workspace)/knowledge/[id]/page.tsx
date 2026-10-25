import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { cache } from "react";
import { notFound } from "next/navigation";
import { Breadcrumb, Section } from "@/components/page";
import { ingestErrorMessage } from "@/server/modules/kb/ingest-errors";
import { getKbDocument } from "@/server/modules/kb/service";
import { can } from "@/server/platform/auth/permissions";
import { AppError } from "@/server/platform/errors";
import { requireAppWorkspace } from "../../workspace-context";
import { AutoRefresh } from "../auto-refresh";
import { DocumentActions } from "../document-actions";
import { formatBytes, isInProgress, typeLabel } from "../labels";
import { DocumentStatusBadge } from "../status-badge";
import { formatDateTime } from "@/lib/format";

/** Cached per request, so the title and the page share one query. */
const load = cache(async (id: string) => {
  await requireAppWorkspace(); // signed-out visitors are redirected, here and in the title
  try {
    return await getKbDocument(await headers(), id);
  } catch (err) {
    // Unknown ids and other workspaces' documents are both "not found" (T1).
    if (err instanceof AppError && err.status === 404) return null;
    throw err;
  }
});

/** The tab shows the document's own title, as ticket pages show theirs. */
export async function generateMetadata({ params }: PageProps<"/app/knowledge/[id]">): Promise<Metadata> {
  const data = await load((await params).id);
  return { title: data ? data.document.title : "Document not found" };
}

export default async function DocumentPage({ params }: PageProps<"/app/knowledge/[id]">) {
  const { ctx } = await requireAppWorkspace();
  const data = await load((await params).id);
  if (!data) notFound();
  const { document: d, chunks } = data;
  const manage = can(ctx.role, { kb: ["write"] });

  const facts: [string, React.ReactNode][] = [
    [
      "File",
      <span key="file" className="break-all">
        {d.filename}
      </span>,
    ],
    ["Type", typeLabel(d.mimeType)],
    ["Size", formatBytes(d.sizeBytes)],
    ...(d.pageCount !== null ? ([["Pages", d.pageCount]] as [string, React.ReactNode][]) : []),
    ["Passages", d.chunkCount],
    ["Tokens (estimate)", d.tokenEstimate.toLocaleString("en-US")],
    ["Embedding model", d.embeddingModel ?? "—"],
    [
      "Added",
      <time key="added" dateTime={d.createdAt.toISOString()}>
        {formatDateTime(d.createdAt)}
      </time>,
    ],
    [
      "Processed",
      d.ingestedAt ? <time dateTime={d.ingestedAt.toISOString()}>{formatDateTime(d.ingestedAt)}</time> : "—",
    ],
  ];

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb parent={{ href: "/app/knowledge", label: "Knowledge base" }} current={d.title} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{d.title}</h1>
          <DocumentStatusBadge status={d.status} />
        </div>
        <AutoRefresh inProgress={isInProgress(d.status) ? 1 : 0} />
      </div>

      {d.status === "failed" && (
        <div className="border-danger-border bg-danger-subtle text-danger-strong flex gap-3 rounded-xl border p-4 text-sm">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">This document could not be processed.</p>
            <p>{ingestErrorMessage(d.errorCode)}</p>
          </div>
        </div>
      )}

      {manage && <DocumentActions id={d.id} title={d.title} canRetry={d.status === "failed"} />}

      <Section id="details" title="Details">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <section aria-labelledby="passages-heading" className="flex flex-col gap-3">
        <h2 id="passages-heading" className="text-base font-semibold">
          Passages <span className="text-muted-foreground font-normal tabular-nums">({chunks.length})</span>
        </h2>
        <p className="text-muted-foreground text-sm">
          The document is split into passages of about 500 tokens, with a little overlap. Search and AI drafts
          work with these passages, exactly as shown.
        </p>
        {chunks.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            {d.status === "ready" ? "No passages." : "Passages appear here once processing has finished."}
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {chunks.map((c) => (
              <li key={c.id} className="bg-card flex flex-col gap-2 rounded-xl border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">
                    Passage {c.ordinal + 1}
                    {c.headingPath && (
                      <span className="text-muted-foreground font-normal"> · {c.headingPath}</span>
                    )}
                  </h3>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    ~{c.tokenEstimate} tokens
                  </span>
                </div>
                {/* Untrusted text: rendered as text by React, never as HTML. */}
                <p className="text-muted-foreground text-sm leading-relaxed break-words whitespace-pre-wrap">
                  {c.content}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
