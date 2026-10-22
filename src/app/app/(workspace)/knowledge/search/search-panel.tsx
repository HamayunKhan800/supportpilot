"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextareaField, useFocusFirstInvalid } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fieldErrors, postJson } from "@/lib/api-client";
// From limits, not schemas: importing Zod into the browser trips the strict CSP (its eval probe).
import { KB_MAX_QUERY_LENGTH } from "@/server/modules/kb/limits";

interface SearchResults {
  query: string;
  model: string | null;
  results: {
    rank: number;
    chunk: { id: string; ordinal: number; headingPath: string; content: string; tokenEstimate: number };
    document: { id: string; title: string };
    rrfScore: number;
    matchedBy: ("vector" | "keyword")[];
    vector: { rank: number; similarity: number } | null;
    keyword: { rank: number; score: number } | null;
  }[];
  timingsMs: { embedding: number; retrieval: number };
}

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [data, setData] = useState<SearchResults | null>(null);
  const [attempt, setAttempt] = useState(0);
  const formRef = useFocusFirstInvalid(attempt);
  const resultsHeading = useRef<HTMLHeadingElement>(null);

  // Move focus to the results so screen-reader and keyboard users know they arrived.
  useEffect(() => {
    if (data) resultsHeading.current?.focus();
  }, [data]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setFieldError("");
    if (!query.trim()) {
      setFieldError("Enter a question to search for.");
      setAttempt((n) => n + 1);
      return;
    }
    setPending(true);
    const result = await postJson<SearchResults>("/api/v1/kb/search", { query });
    setPending(false);
    if (!result.ok) {
      const fields = fieldErrors(result.problem);
      if (fields.query) {
        setFieldError(fields.query);
        setAttempt((n) => n + 1);
      } else setError(result.message);
      return;
    }
    setData(result.data);
  }

  return (
    <div className="flex flex-col gap-6">
      <form ref={formRef} onSubmit={onSubmit} noValidate role="search" className="flex flex-col gap-3">
        <TextareaField
          label="Question"
          name="query"
          rows={3}
          maxLength={KB_MAX_QUERY_LENGTH}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          hint={`For example: “How long do refunds take?” Up to ${KB_MAX_QUERY_LENGTH} characters.`}
          error={fieldError}
        />
        <div>
          <Button type="submit" size="lg" className="h-10" disabled={pending}>
            {pending ? "Searching…" : "Search"}
          </Button>
        </div>
      </form>
      <FormAlert message={error} />

      {data && (
        <section aria-labelledby="search-results-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="search-results-heading"
              ref={resultsHeading}
              tabIndex={-1}
              className="text-lg font-semibold outline-none"
            >
              {data.results.length} passage{data.results.length === 1 ? "" : "s"} for “{data.query}”
            </h2>
            {data.model && (
              <p className="text-muted-foreground text-xs tabular-nums">
                Embedding {data.timingsMs.embedding} ms · retrieval {data.timingsMs.retrieval} ms ·{" "}
                {data.model}
              </p>
            )}
          </div>
          {data.results.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border p-6 text-sm">
              {data.model === null ? (
                <>
                  There are no processed documents to search yet.{" "}
                  <Link href="/app/knowledge" className="text-foreground underline">
                    Add a document
                  </Link>
                </>
              ) : (
                "No passages matched this question."
              )}
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {data.results.map((r) => (
                <li key={r.chunk.id} className="flex flex-col gap-2 rounded-lg border p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-muted-foreground text-sm tabular-nums">#{r.rank}</span>
                    <h3 className="font-medium">
                      <Link href={`/app/knowledge/${r.document.id}`} className="underline">
                        {r.document.title}
                      </Link>
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        · Passage {r.chunk.ordinal + 1}
                        {r.chunk.headingPath ? ` · ${r.chunk.headingPath}` : ""}
                      </span>
                    </h3>
                  </div>
                  <p className="line-clamp-6 text-sm break-words whitespace-pre-wrap">{r.chunk.content}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Found by:</span>
                    {r.vector && (
                      <Badge variant="outline" className="border-blue-300 text-blue-800">
                        Meaning #{r.vector.rank} · similarity {r.vector.similarity.toFixed(2)}
                      </Badge>
                    )}
                    {r.keyword && (
                      <Badge variant="outline" className="border-violet-300 text-violet-800">
                        Keywords #{r.keyword.rank}
                      </Badge>
                    )}
                    <span className="text-muted-foreground tabular-nums">
                      Combined score {r.rrfScore.toFixed(4)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
