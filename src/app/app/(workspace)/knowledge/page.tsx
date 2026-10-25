import { BookOpen, FileText, FileType, Search } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { FormAlert } from "@/components/form-alert";
import { MeterBar } from "@/components/meter";
import { EmptyState, PageHeader } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { ingestErrorMessage } from "@/server/modules/kb/ingest-errors";
import { listKbDocuments } from "@/server/modules/kb/service";
import { can } from "@/server/platform/auth/permissions";
import { Age } from "../tickets/ticket-bits";
import { requireAppWorkspace } from "../workspace-context";
import { AutoRefresh } from "./auto-refresh";
import { formatBytes, isInProgress, typeLabel } from "./labels";
import { DocumentStatusBadge } from "./status-badge";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Knowledge base" };

const requestTime = () => Date.now();

/** A usage meter: label, "x of y" and a bar. The text carries the numbers; the bar only repeats them. */
function Meter({ label, text, ratio }: { label: string; text: string; ratio: number }) {
  return (
    <div className="flex min-w-40 flex-1 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{text}</span>
      </div>
      <MeterBar value={ratio} tone={ratio >= 0.9 ? "warning" : "brand"} />
    </div>
  );
}

export default async function KnowledgePage({ searchParams }: PageProps<"/app/knowledge">) {
  const { ctx } = await requireAppWorkspace();
  const manage = can(ctx.role, { kb: ["write"] });
  const { items, usage } = await listKbDocuments(await headers());
  const now = requestTime();
  const inProgress = items.filter((d) => isInProgress(d.status)).length;
  const deleted = (await searchParams).deleted === "1";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Knowledge base"
        description={
          <>
            Help articles that AI drafts will cite.{" "}
            {manage ? "Add, check and remove documents here." : "Only admins and owners can change them."}
          </>
        }
        actions={
          manage && (
            <Link href="/app/knowledge/search" className={buttonVariants({ variant: "outline" })}>
              <Search aria-hidden="true" />
              Test search
            </Link>
          )
        }
      />

      {deleted && <FormAlert message="Document deleted." tone="success" />}
      {manage && <UploadForm />}

      <section aria-labelledby="documents-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <h2 id="documents-heading" className="text-base font-semibold">
            Documents
          </h2>
          <div className="grid w-full grid-cols-1 gap-x-6 gap-y-3 sm:flex sm:w-auto sm:min-w-[28rem]">
            <Meter
              label="Documents"
              text={`${usage.documentCount} of ${usage.maxDocuments} documents`}
              ratio={usage.documentCount / usage.maxDocuments}
            />
            <Meter
              label="Storage"
              text={`${formatBytes(usage.totalBytes)} of ${formatBytes(usage.maxBytes)}`}
              ratio={usage.totalBytes / usage.maxBytes}
            />
          </div>
        </div>
        <AutoRefresh inProgress={inProgress} />
        {items.length === 0 ? (
          <EmptyState icon={BookOpen} title="No documents yet.">
            {manage
              ? "Upload your first help article above. AI drafts can only cite what is here."
              : "An admin or owner can add help articles for AI drafts to cite."}
          </EmptyState>
        ) : (
          <ul className="bg-card divide-y rounded-xl border">
            {items.map((d) => {
              const Icon = d.mimeType === "application/pdf" ? FileType : FileText;
              return (
                <li
                  key={d.id}
                  className="hover:bg-muted/50 active:bg-muted relative flex items-start gap-3 px-4 py-3 transition-colors duration-150 sm:items-center"
                >
                  <Icon aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0 sm:mt-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <Link
                      href={`/app/knowledge/${d.id}`}
                      className="truncate text-sm font-medium after:absolute after:inset-0 hover:underline"
                    >
                      {d.title}
                    </Link>
                    <span className="text-muted-foreground truncate text-xs">
                      {typeLabel(d.mimeType)} · {formatBytes(d.sizeBytes)}
                      {d.status === "ready"
                        ? ` · ${d.chunkCount} passage${d.chunkCount === 1 ? "" : "s"}`
                        : ""}
                    </span>
                    {d.status === "failed" && (
                      <span className="text-danger-strong text-xs">{ingestErrorMessage(d.errorCode)}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                    <DocumentStatusBadge status={d.status} />
                    <Age date={d.createdAt} now={now} prefix="Added" className="w-12 text-right text-xs" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
