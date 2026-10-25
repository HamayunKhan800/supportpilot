"use client";

import { FileText, TriangleAlert, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { useFocusFirstInvalid } from "@/components/form-field";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { postForm } from "@/lib/api-client";
import { KB_MAX_UPLOAD_BYTES } from "@/server/modules/kb/limits";
import { ACCEPT, formatBytes } from "./labels";

const MAX_LABEL = formatBytes(KB_MAX_UPLOAD_BYTES);

/**
 * Sends the file to the REST endpoint (plan D12), which runs every check. The checks here
 * only give faster feedback; they are not relied on.
 *
 * The file input sits inside a drop zone (design step 9.5): drop a file on it or click it. The
 * real input stays (visually hidden, focusable, labelled "File"), so keyboard, screen reader and
 * tests use it as before; the zone shows its focus and the chosen file's name and size.
 */
export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const formRef = useFocusFirstInvalid(attempt);
  const id = useId();
  const [chosen, setChosen] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Kept now: React clears `e.currentTarget` once the handler awaits.
    const formEl = e.currentTarget;
    setError("");
    setFieldError("");
    setExistingId(null);
    setSuccess("");
    const file = inputRef.current?.files?.[0];
    const local = !file
      ? "Choose a file to upload."
      : file.size > KB_MAX_UPLOAD_BYTES
        ? `Files are limited to ${MAX_LABEL}. This one is ${formatBytes(file.size)}.`
        : "";
    if (local || !file) {
      setFieldError(local);
      setAttempt((n) => n + 1);
      return;
    }

    const form = new FormData();
    form.set("file", file, file.name);
    setPending(true);
    const result = await postForm<{ id: string; title: string }>("/api/v1/kb/documents", form, {
      413: `Files are limited to ${MAX_LABEL}.`,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      if (typeof result.problem.existingDocumentId === "string")
        setExistingId(result.problem.existingDocumentId);
      return;
    }
    formEl.reset();
    setChosen(null);
    setSuccess(`Uploaded “${result.data.title}”. It is queued for processing.`);
    router.refresh();
  }

  return (
    <section aria-labelledby="upload-heading" className="bg-card rounded-xl border">
      <div className="border-b px-4 py-3">
        <div className="min-w-0">
          <h2 id="upload-heading" className="text-sm font-semibold">
            Add a document
          </h2>
          <p className="text-muted-foreground mt-0.5 max-w-prose text-sm">
            Markdown, plain text or PDF, up to {MAX_LABEL} each. Text is extracted, split into passages and
            indexed for search. Scanned PDFs (images of text) are not supported.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-4 p-4">
        <p className="border-warning-border bg-warning-subtle text-warning-strong flex gap-2 rounded-lg border px-3 py-2 text-sm">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">Demo: do not upload confidential or personal documents.</strong>{" "}
            Passages may be sent to an external AI provider to be indexed.
          </span>
        </p>
        <form
          ref={formRef}
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-4 sm:flex-row sm:items-start"
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor={id}>File</Label>
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const files = e.dataTransfer.files;
                if (!files.length || !inputRef.current) return;
                const dt = new DataTransfer();
                dt.items.add(files[0]!);
                inputRef.current.files = dt.files;
                setChosen(files[0]!);
                setFieldError("");
              }}
              className={cn(
                "text-muted-foreground flex min-h-20 cursor-pointer items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors",
                "hover:border-foreground/40 hover:bg-muted/50 has-[input:focus-visible]:outline-ring has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2",
                dragging && "border-foreground/60 bg-muted",
                fieldError && "border-danger-border",
              )}
            >
              <input
                ref={inputRef}
                id={id}
                name="file"
                type="file"
                accept={ACCEPT}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={`${id}-hint${fieldError ? ` ${id}-error` : ""}`}
                onChange={(e) => {
                  setChosen(e.currentTarget.files?.[0] ?? null);
                  setFieldError("");
                }}
                className="sr-only"
              />
              {chosen ? (
                <>
                  <FileText aria-hidden="true" className="text-foreground size-5 shrink-0" />
                  <span className="min-w-0">
                    <span className="text-foreground block truncate font-medium">{chosen.name}</span>
                    <span className="block text-xs">
                      {formatBytes(chosen.size)} · click to choose another
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <Upload aria-hidden="true" className="size-5 shrink-0" />
                  <span>
                    <span className="text-foreground font-medium">Drop a file here</span> or click to choose
                    one
                  </span>
                </>
              )}
            </div>
            <p id={`${id}-hint`} className="text-muted-foreground text-sm">
              .md, .txt or .pdf
            </p>
            {fieldError && (
              <p id={`${id}-error`} className="text-destructive text-sm">
                {fieldError}
              </p>
            )}
          </div>
          <Button type="submit" size="lg" className="h-10 sm:mt-6 sm:self-start" disabled={pending}>
            <Upload aria-hidden="true" />
            {pending ? "Uploading…" : "Upload"}
          </Button>
        </form>
        <FormAlert message={error} />
        {existingId && (
          <Link href={`/app/knowledge/${existingId}`} className="text-primary text-sm font-medium underline">
            Open the existing document
          </Link>
        )}
        <FormAlert message={success} tone="success" />
      </div>
    </section>
  );
}
