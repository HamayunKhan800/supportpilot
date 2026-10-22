"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { FormField, useFocusFirstInvalid } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { postForm } from "@/lib/api-client";
import { KB_MAX_UPLOAD_BYTES } from "@/server/modules/kb/limits";
import { ACCEPT, formatBytes } from "./labels";

const MAX_LABEL = formatBytes(KB_MAX_UPLOAD_BYTES);

/**
 * Sends the file to the REST endpoint (plan D12), which runs every check. The checks here
 * only give faster feedback; they are not relied on.
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
    setSuccess(`Uploaded “${result.data.title}”. It is queued for processing.`);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Add a document</h2>
        </CardTitle>
        <CardDescription>
          Help articles as Markdown, plain text or PDF, up to {MAX_LABEL} each. Text is extracted, split into
          passages and indexed for search. Scanned PDFs (images of text) are not supported.{" "}
          <strong className="text-foreground font-semibold">
            Demo: do not upload confidential or personal documents.
          </strong>{" "}
          Passages may be sent to an external AI provider to be indexed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          ref={formRef}
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-4 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <FormField
              ref={inputRef}
              label="File"
              name="file"
              type="file"
              accept={ACCEPT}
              hint=".md, .txt or .pdf"
              error={fieldError}
              className="h-10 py-1.5"
            />
          </div>
          <Button type="submit" size="lg" className="h-10" disabled={pending}>
            {pending ? "Uploading…" : "Upload"}
          </Button>
        </form>
        <FormAlert message={error} />
        {existingId && (
          <Link href={`/app/knowledge/${existingId}`} className="text-sm font-medium underline">
            Open the existing document
          </Link>
        )}
        <FormAlert message={success} tone="success" />
      </CardContent>
    </Card>
  );
}
