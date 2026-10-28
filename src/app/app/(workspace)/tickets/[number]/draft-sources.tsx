import { Tooltip } from "@base-ui/react/tooltip";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { excerpt } from "@/lib/draft-checks";
import { splitCitations } from "@/server/modules/drafts/citations";
import type { ApiDraft } from "@/server/modules/drafts/serialize";

/** The cited parts of a ready draft: its text with [n] markers, and the numbered source list. */

type Citation = ApiDraft["citations"][number];

/** Which source passage is open, shared by the markers in the text and the source list. */
interface SourceToggle {
  openSource: number | null;
  regionId: (marker: number) => string;
  onToggle: (marker: number) => void;
}

/** The draft as text (never HTML or Markdown); a known [n] becomes a CitationMarker. */
export function DraftText({
  body,
  citations,
  openSource,
  regionId,
  onToggle,
}: { body: string; citations: readonly Citation[] } & SourceToggle) {
  const byMarker = new Map(citations.map((c) => [c.marker, c]));
  return (
    <div className="bg-background rounded-lg border p-3.5 leading-relaxed" data-testid="draft-text">
      <Tooltip.Provider delay={250} closeDelay={80}>
        <p className="break-words whitespace-pre-wrap">
          {splitCitations(body).map((s, i) =>
            s.type === "text" ? (
              <Fragment key={i}>{s.text}</Fragment>
            ) : byMarker.has(s.marker) ? (
              <CitationMarker
                key={i}
                citation={byMarker.get(s.marker)!}
                open={openSource === s.marker}
                regionId={regionId(s.marker)}
                onToggle={() => onToggle(s.marker)}
              />
            ) : (
              <Fragment key={i}>[{s.marker}]</Fragment>
            ),
          )}
        </p>
      </Tooltip.Provider>
    </div>
  );
}

export function SourceList({
  citations,
  openSource,
  regionId,
  onToggle,
}: { citations: readonly Citation[] } & SourceToggle) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Sources</h3>
      <ol className="flex flex-col gap-2">
        {citations.map((c) => (
          <SourceItem
            key={c.marker}
            citation={c}
            open={openSource === c.marker}
            regionId={regionId(c.marker)}
            onToggle={() => onToggle(c.marker)}
          />
        ))}
      </ol>
    </div>
  );
}

/** [1] in the draft: hover or focus shows the passage; a click opens it in the source list. */
function CitationMarker({
  citation: c,
  open,
  regionId,
  onToggle,
}: {
  citation: Citation;
  open: boolean;
  regionId: string;
  onToggle: () => void;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={regionId}
            aria-label={`Source ${c.marker}: ${c.documentTitle}`}
            className="bg-brand-subtle text-brand-strong focus-visible:ring-ring mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded px-1 align-[0.1em] text-xs leading-none font-semibold tabular-nums hover:underline focus-visible:ring-2 focus-visible:outline-none"
          />
        }
      >
        {c.marker}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={6} collisionPadding={12} className="z-50">
          <Tooltip.Popup className="glass text-popover-foreground w-[min(22rem,calc(100vw-1.5rem))] origin-[var(--transform-origin)] rounded-lg border p-3 text-sm shadow-lg transition-[opacity,scale] duration-150 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none">
            <p className="font-medium break-words">
              {c.documentTitle}
              {c.headingPath && <span className="text-muted-foreground font-normal"> › {c.headingPath}</span>}
            </p>
            <p className="text-muted-foreground mt-1.5 break-words">{excerpt(c.content)}</p>
            {c.sourceRemoved && (
              <p className="text-warning-strong mt-1.5 text-xs">
                This article changed after the draft was written.
              </p>
            )}
            <p className="text-muted-foreground mt-2 text-xs">Click to open the full passage.</p>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function SourceItem({
  citation: c,
  open,
  regionId,
  onToggle,
}: {
  citation: Citation;
  open: boolean;
  regionId: string;
  onToggle: () => void;
}) {
  return (
    <li className="rounded-lg border text-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={regionId}
        className="hover:bg-muted focus-visible:ring-ring flex min-h-9 w-full items-start gap-2 rounded-lg p-2 text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="bg-brand-subtle text-brand-strong inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-xs font-semibold tabular-nums">
          {c.marker}
        </span>
        <span className="min-w-0 flex-1 break-words">
          {c.documentTitle}
          {c.headingPath && <span className="text-muted-foreground"> › {c.headingPath}</span>}
        </span>
        {c.sourceRemoved && (
          <Badge variant="outline" className="border-warning-border text-warning-strong">
            Source removed
          </Badge>
        )}
      </button>
      <div id={regionId} hidden={!open} className="border-t p-2">
        {c.sourceRemoved && (
          <p className="text-warning-strong mb-1 text-xs">
            This article was deleted or replaced after the draft was written. This is the passage as it was.
          </p>
        )}
        <p className="max-h-60 overflow-y-auto break-words whitespace-pre-wrap">{c.content}</p>
      </div>
    </li>
  );
}
