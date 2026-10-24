"use client";

import { CircleCheck, SearchX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextareaField, useFocusFirstInvalid } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { MeterBar } from "@/components/meter";
import { Button } from "@/components/ui/button";
import { fieldErrors, postJson } from "@/lib/api-client";
import { highlightSegments, queryTerms } from "@/lib/highlight";
import { cn } from "@/lib/utils";
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

interface Floor {
  value: number;
  /** "workspace": the AI settings value (Gemini). "mock": the offline embedder's fixed floor. */
  source: "workspace" | "mock";
}

const floorText = (floor: Floor) =>
  floor.source === "workspace"
    ? `the ${floor.value.toFixed(2)} refusal floor`
    : `the offline floor (${floor.value})`;

/** Says whether a draft for this question would reach the model, from the best passage's similarity. */
function FloorSummary({ results, floor }: { results: SearchResults["results"]; floor: Floor }) {
  const best = Math.max(...results.map((r) => r.vector?.similarity ?? 0));
  const passes = best >= floor.value;
  return (
    <p
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2 text-sm",
        passes
          ? "border-success-border bg-success-subtle text-success-strong"
          : "border-warning-border bg-warning-subtle text-warning-strong",
      )}
    >
      {passes ? (
        <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      ) : (
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      )}
      <span>
        Best similarity {best.toFixed(2)} is {passes ? "at or above" : "below"} {floorText(floor)}.{" "}
        {passes
          ? "A draft for this question would be written from these passages."
          : "A draft would be refused without calling the AI model."}
        {floor.source === "mock" && " Offline mock embeddings: scores are not comparable to Gemini's."}
      </span>
    </p>
  );
}

/** Similarity on a 0–1 bar with the floor marked. The numbers are in the text beside it. */
function SimilarityMeter({ similarity, floor }: { similarity: number; floor: Floor }) {
  const passes = similarity >= floor.value;
  return (
    <div className="flex items-center gap-3 text-xs">
      <MeterBar
        value={similarity}
        marker={floor.value}
        tone={passes ? "success" : "warning"}
        className="max-w-48 flex-1"
      />
      <span className="text-muted-foreground tabular-nums">
        {similarity.toFixed(2)} {passes ? "≥" : "<"} floor {floor.value.toFixed(2)}
      </span>
    </div>
  );
}

export function SearchPanel({ floor }: { floor: Floor }) {
  const [query, setQuery] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [data, setData] = useState<SearchResults | null>(null);
  const [attempt, setAttempt] = useState(0);
  const formRef = useFocusFirstInvalid(attempt);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const terms = useMemo(() => (data ? queryTerms(data.query) : []), [data]);

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
              className="text-base font-semibold outline-none"
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
            <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm">
              <SearchX aria-hidden="true" className="size-5" />
              {data.model === null ? (
                <p>
                  There are no processed documents to search yet.{" "}
                  <Link href="/app/knowledge" className="text-primary font-medium underline">
                    Add a document
                  </Link>
                </p>
              ) : (
                <p>No passages matched this question.</p>
              )}
            </div>
          ) : (
            <>
              <FloorSummary results={data.results} floor={floor} />
              <ol className="flex flex-col gap-3">
                {data.results.map((r) => (
                  <li key={r.chunk.id} className="bg-card flex flex-col gap-3 rounded-xl border p-4">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="bg-muted inline-flex h-5 min-w-6 items-center justify-center rounded px-1 text-xs font-medium tabular-nums">
                        #{r.rank}
                      </span>
                      <h3 className="text-sm font-medium">
                        <Link
                          href={`/app/knowledge/${r.document.id}`}
                          className="text-primary hover:underline"
                        >
                          {r.document.title}
                        </Link>
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · Passage {r.chunk.ordinal + 1}
                          {r.chunk.headingPath ? ` · ${r.chunk.headingPath}` : ""}
                        </span>
                      </h3>
                    </div>
                    {/* Untrusted text: React renders the segments as text, never as HTML. */}
                    <p className="text-muted-foreground line-clamp-6 text-sm leading-relaxed break-words whitespace-pre-wrap">
                      {highlightSegments(r.chunk.content, terms).map((seg, i) =>
                        seg.match ? (
                          <mark key={i} className="bg-warning-subtle text-foreground rounded-sm px-0.5">
                            {seg.text}
                          </mark>
                        ) : (
                          seg.text
                        ),
                      )}
                    </p>
                    {r.vector && <SimilarityMeter similarity={r.vector.similarity} floor={floor} />}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Found by:</span>
                      {r.vector && (
                        <Badge variant="outline" className="border-info-border text-info-strong">
                          Meaning #{r.vector.rank} · similarity {r.vector.similarity.toFixed(2)}
                        </Badge>
                      )}
                      {r.keyword && (
                        <Badge variant="outline" className="border-brand-border text-brand-strong">
                          Keywords #{r.keyword.rank}
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {terms.length > 0 && (
                <p className="text-muted-foreground text-xs">
                  Highlighted: words from your question. Passages are ranked by meaning, so a good match can
                  contain none of them.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
