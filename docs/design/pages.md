# Workspace pages

Design system step 4 (`docs/plans/design-system.md` §5). This note covers the shared page building blocks and the pages
redesigned so far; Analytics, Evaluation and the admin pages follow in steps 4b and 4c.

## Shared building blocks

`src/components/page.tsx` and `src/components/meter.tsx`, used by every workspace page:

| Block        | What it is                                                                                       | Notes                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PageHeader` | `h1`, one-line description, actions on the right (wrap below on phones)                          | One header pattern for every page.                                                                                                               |
| `StatGrid`   | A `<dl>` of stat tiles, 2 columns on phones, 4 on desktop                                        | Each tile is a term (label) and a definition (number), so screen readers read "Open, 10".                                                        |
| `Stat`       | Label with a tinted icon, number, optional note; the number can be a link (whole tile clickable) | The link's accessible name is the number plus `srSuffix` ("10 open tickets").                                                                    |
| `Section`    | Card with a titled header (`h2`), optional description and actions, then the body                | Flat (border, no shadow), as in the plan's elevation rule.                                                                                       |
| `EmptyState` | Dashed box: icon, one line, explanation, optional next action                                    | Every empty list says what would fill it.                                                                                                        |
| `TabNav`     | Underlined links between sibling pages, `aria-current="page"` on the current one                 | For Analytics / Evaluation (step 4b).                                                                                                            |
| `MeterBar`   | A thin bar with an optional marker line                                                          | Decorative (`aria-hidden`): the number is always in the text beside it. SVG geometry, not inline `style`, because the CSP forbids inline styles. |

## Overview

Before: three cards of numbers and underlined links. After:

- **Four stat tiles**, each a link to the right view: Open, Waiting for customer, Needs review (inbox filtered to
  `needsReview=true`; amber when above zero) and Articles ready to cite (green, or red when a document failed; the note
  says how many are processing or failed).
- **Latest active tickets**: the five newest open or waiting tickets, with the same status icon, "Needs review" and "AI
  draft ready" tags as the inbox, so an agent can start work from the overview.
- A narrow column with the knowledge base, customer portal and team cards. "Add your first document" appears while the
  knowledge base is empty.

No new backend: the counts come from the existing ticket counts, ticket list (`limit: 5`, and `needsReview` with a page of
100, shown as "100+" beyond that) and document list.

## Knowledge base

- **Upload** is a titled section with the demo warning as an amber callout, a dashed file field and an icon button.
- **Usage** is two meters (documents and storage) beside the "Documents" heading; they turn amber at 90%.
- **Document rows** have a file-type icon, title, type, size and passages, an ingestion **status chip** (icon + label:
  Queued, Processing with a spinner that stops under reduced motion, Ready, Failed) and a relative "Added" time with the
  exact time on hover.
- **Empty state** explains that drafts can only cite what is uploaded.
- The live "Processing…" status line takes no space while empty (`empty:sr-only`) but stays in the accessibility tree,
  so screen readers still hear when processing starts and finishes.

### Document page

Back link with an arrow, title with the status chip, failure explained in a red callout with the retry button, details as
a compact grid inside a section, passages as cards. Delete keeps its inline confirmation (focus moves to "Yes, delete";
Cancel returns focus to Delete).

### Test search

Each result now shows **why it ranked** and **what a draft would do**:

- **Highlighted words.** Words from the question are marked in the passage (`src/lib/highlight.ts`: whole words starting
  with a question word, stop words and words under 3 letters ignored, a light stem so "refunds" marks "refund"). A note
  says that ranking is by meaning, so a good match can contain none of them. The passage is still rendered as text,
  never HTML.
- **Score against the floor.** A meter shows each passage's similarity with the refusal floor marked, and the text says
  "0.71 ≥ floor 0.62". A summary line above the results says whether a draft for this question would be written (best
  similarity at or above the floor) or refused without calling the model.
- **The floor drafts actually use.** With Gemini that is the workspace's AI setting (default 0.62); with the offline mock
  embedder it is the fixed 0.15 (finding #89), and the summary says the mock scores are not comparable to Gemini's.

## Tests

- Unit: `tests/unit/highlight.test.ts` (terms, stemming, stop words, no regex injection, the segments rebuild the text).
- E2E: `knowledge.spec.ts` checks the floor summary, the per-result comparison and a highlighted word.
  `accessibility.spec.ts` now also audits the knowledge list, document page, search results and overview in the dark
  theme; `drafts.spec.ts` audits the overview in the dark theme with tickets and checks it shows "AI draft ready".
