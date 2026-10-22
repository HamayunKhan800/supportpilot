/** Display helpers for the knowledge pages (no server imports: used by client components too). */

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  pending: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

/** Text + border colours that pass WCAG AA contrast on white; the label carries the meaning. */
export const STATUS_CLASS: Record<DocumentStatus, string> = {
  pending: "border-zinc-300 text-zinc-700",
  processing: "border-blue-300 bg-blue-50 text-blue-800",
  ready: "border-green-300 bg-green-50 text-green-800",
  failed: "border-red-300 bg-red-50 text-red-800",
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
