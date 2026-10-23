/** Display helpers for the knowledge pages (no server imports: used by client components too). */

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  pending: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

/** Text + border colours from the design tokens (contrast-tested in both themes); the label carries the meaning. */
export const STATUS_CLASS: Record<DocumentStatus, string> = {
  pending: "border-border text-muted-foreground",
  processing: "border-info-border bg-info-subtle text-info-strong",
  ready: "border-success-border bg-success-subtle text-success-strong",
  failed: "border-danger-border bg-danger-subtle text-danger-strong",
};

export const isInProgress = (status: string) => status === "pending" || status === "processing";

const TYPE_LABEL: Record<string, string> = {
  "text/markdown": "Markdown",
  "text/plain": "Text",
  "application/pdf": "PDF",
};
export const typeLabel = (mimeType: string) => TYPE_LABEL[mimeType] ?? mimeType;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** File types the upload accepts (the server checks the content too). */
export const ACCEPT = ".md,.markdown,.txt,.pdf";
