# Workspace pages

Design system step 4 (`docs/plans/design-system.md` §5). This note covers the shared page building blocks and every
workspace page except the ticket inbox (`docs/design/inbox.md`): Overview and Knowledge (4a), Analytics and Evaluation
(4b), and the admin pages: Members, AI settings, Audit log, Review and Account (4c).

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

Step 4c adds feedback and safety blocks, available to every workspace page (used by the admin pages so far):

| Block                                  | What it is                                                                                                                             | Notes                                                                                                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConfirmDialog`                        | `src/components/confirm-dialog.tsx`: a Base UI AlertDialog in front of destructive actions; replaces `window.confirm`                  | Focus starts on the safe button; Escape or "Keep…/Cancel" changes nothing and returns focus to the trigger. Errors show inside the dialog, which stays open. After a confirmed removal, focus moves to the section heading (the row is gone). |
| `notify` + `Toaster`                   | `src/lib/toast.ts`, `src/components/toaster.tsx`: one Base UI Toast queue for the workspace                                            | Only for actions with no message of their own on the page (role changed, member removed, invitation cancelled, link copied). Inline form messages stay where they were. Polite announcements; errors use high priority and stay 8 s.          |
| `FormSection`                          | `src/components/form-section.tsx`: a settings group, title and explanation on the left, controls on the right                          | Stacks on phones. A `role="group"` named by its title.                                                                                                                                                                                        |
| Error page                             | `src/app/app/(workspace)/error.tsx`                                                                                                    | Renders inside the app shell, so the sidebar keeps working. "Try again" calls Next.js's `retry()`, which re-fetches the page; the reference matches the server log.                                                                           |
| `Section` heading focus, `TableScroll` | Section headings with an `id` take programmatic focus (`tabIndex=-1`); `TableScroll` takes a `className` to sit flush inside a Section | Used as focus targets by `ConfirmDialog`.                                                                                                                                                                                                     |

**No route-level loading skeleton.** A `loading.tsx` was tried and removed: with a Suspense boundary around the page,
React streams parts of it late, and a part that lands inside an SVG chart is sent as `<svg style="display:none">`.
The strict nonce CSP blocks that inline style (the E2E CSP check caught it on Analytics, intermittently). Pages render
on the server in one piece instead; buttons show their own pending text ("Saving…", "Working…").

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

## Analytics (usage)

- **Key numbers** across the top: tickets created, draft acceptance, AI tokens and estimated cost. Three have a
  **sparkline** (the period's daily series, already returned by the analytics service: no new query) and a **change
  line**, e.g. "Last 15 days: up 23% vs the 15 before". The change compares the newer half of the selected period with
  the older half (`periodChange` in `src/components/charts/scale.ts`; with an odd number of days the oldest day is left
  out so both halves are equally long). It is worded and coloured neutrally: more tickets or tokens is not good or bad
  by itself. When the older half is zero there is no percentage ("25, none in the 15 before"), never "+∞%".
- **Tickets**: a stacked status bar (open, pending, resolved, closed in four chart colours) whose legend names each
  part with its count and share; the daily bar chart in the brand chart colour with a dashed middle gridline; the
  category table with a share bar in each row.
- **AI reply drafts**: the outcomes as a stacked bar (sent, discarded, waiting, refused, and "blocked, failed or
  cancelled" together), empty parts left out of the legend.
- The period picker is a segmented control of links (each period is a shareable URL).
- Sparklines and bars are decorative; every number is in text or in the chart's "Show as a table".

## Evaluation

- A **"Targets met" tile** ("4 of 4", green when all are met, amber otherwise) whose note says how many targets have no
  data yet and that targets are hypotheses to test (docs/04), not promises.
- Each metric with a target has a **Met / Not met / No data chip** beside the number. The chip is hidden from screen
  readers because the line under the number already says "target ≥ 85% · met".
- The **interval bars** colour the measured mark green or red by the target outcome, show the 95% interval as a tinted
  band and the target as a dashed line; the legend says so in words.
- Groundedness carries an **"AI-graded"** badge next to its name, as well as the note "AI-graded, not checked against a
  human".
- The mock-run and unfinished-run notices are info and warning callouts; an empty provider shows an empty state with
  the command that fills it.

## Members

- Page header, then three sections: **Invite a teammate** (form; the new link appears in a tinted box with Copy),
  **Team** (table flush in the section: initials avatar, name and email, role badge, joined date, actions) and
  **Pending invitations** (rows with Copy link / Cancel; an empty state when none).
- Role badges: owner solid brand, admin brand tint, agent neutral.
- Changing a role saves at once and confirms with a toast ("Aaron Agent is now an admin"); if it fails, the select
  goes back to the role they still have and the error shows under it.
- **Remove** and **Cancel invitation** ask first in a `ConfirmDialog` that says what happens ("They lose access to
  this workspace straight away. You can invite them again later."). Cancel's safe button reads "Keep invitation", so
  two "Cancel" buttons never sit side by side.
- Cancelling an invitation now reports errors (before, a failure was silent). Clipboard failures (it needs HTTPS)
  show an error toast asking the user to copy the link by hand.

## AI settings

- Page header; **This month's usage** and **Settings** are Sections.
- The form is four `FormSection` groups: **AI features** (one switch), **Budget**, **Triage** (auto-apply threshold
  and categories) and **Reply drafts** (minimum match score).
- The AI switch is a native checkbox with `role="switch"`, drawn with CSS only; keyboard and form behaviour are the
  checkbox's own.
- A footer row holds **Save settings**; once something changes, **Discard changes** and the note "Unsaved changes"
  appear beside it. Saving keeps the existing inline "Settings saved." message (no toast, so it isn't announced twice).
- Category chips use an icon remove button (32 px target) with the name in its label ("Remove feature-request").

## Audit log

- Page header with an honest description (members, tickets, knowledge and AI settings, not only membership).
- Each event has a small decorative icon for its area (people, ticket, knowledge, settings, workspace).
- Empty state explains what will be recorded; past the last page it says so and links back to the newest events.
- "Older events" / "Newest events" are outline buttons in a labelled `nav`.

## Review and Account

- **Review:** shared page header with the "N of M checked" total as a pill on the right; the Start / Continue links use
  the shared button style. The item page is unchanged (its tests depend on the existing link text).
- **Account:** **Profile** (initials avatar, name, email, role in this workspace), **Appearance** (Device / Light /
  Dark as a radio group, the same preference as the account menu and command palette) and **Change password**.

## Tests

- Unit: `tests/unit/highlight.test.ts` (terms, stemming, stop words, no regex injection, the segments rebuild the text);
  `tests/unit/analytics-view.test.ts` adds `periodChange` and `sparkPoints`.
- E2E: `knowledge.spec.ts` checks the floor summary, the per-result comparison and a highlighted word.
  `accessibility.spec.ts` now also audits the knowledge list, document page, search results and overview in the dark
  theme; `drafts.spec.ts` audits the overview in the dark theme with tickets and checks it shows "AI draft ready".
- `analytics.spec.ts` checks the key numbers' change line, the status legend and the Met / Not met chips;
  `theme.spec.ts` audits both analytics pages in the dark theme.
- Step 4c: `workspace-journey.spec.ts` checks the role-change toast, then a new test cancels an invitation (Keep
  invitation first: focus returns, nothing changes; then confirm: toast and empty state) and removes a member (Escape
  backs out; confirm: toast, row gone, focus on the Team heading), auditing the dialog and the page with axe, and
  finds both events in the audit log. `settings.spec.ts` checks the switch role and Discard changes; `shell.spec.ts`
  switches theme from the Account page and audits it in the dark theme; `accessibility.spec.ts` and `theme.spec.ts`
  now audit AI settings in both themes. `tests/unit/initials.test.ts` covers the shared avatar initials.
- Not covered by an automated test: the workspace error page (it needs a server error to appear); it is type-checked
  and built.
