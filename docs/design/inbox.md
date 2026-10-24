# Inbox, ticket page and AI draft card

Design system step 3 (`docs/plans/design-system.md`). The backend is unchanged: every view is
built from the existing list, ticket and draft endpoints.

## Ticket list (`src/app/app/(workspace)/tickets/page.tsx`)

- **Dense rows**, one line on wide screens: status icon, number, subject (the row link), customer, category tag,
  "Needs review", priority, assignee, age. Below `md` the row stacks and priority moves under the subject.
- **Status and priority differ by shape, not only colour** (WCAG 1.4.1): open ◉, pending clock, resolved ✓,
  closed lock; priority uses 1–3 signal bars and a flame for urgent. Each also has its name as text.
- **Ages** are compact ("5m", "3h", "2d", "Oct 3"). Screen readers hear "Opened 5 minutes ago", and the exact UTC time
  is in `<time dateTime>` and the hover title (`src/lib/relative-time.ts`).
- **Quick filters** are one-click links over the existing filters: Assigned to me (`assignee=me`), Unassigned,
  Needs review (`needsReview=true`). The active one has `aria-current="true"` and a check mark. They replace the old
  "Only AI suggestions that need review" checkbox.
- **Filter bar:** search, priority, category, assignee, sort and Apply in one row on wide screens. It is still a plain
  GET form, so it works without JavaScript. Labels are visually hidden, and each select's first option names it
  ("Any priority").
- **Empty states** explain the situation: no requests yet (link to the portal), no matches (link to the whole tab),
  or an empty tab.
- **Not built:** an "AI draft ready" marker on rows. The list endpoint has no draft field, and this step leaves the
  backend unchanged.

## Ticket page (`tickets/[number]/page.tsx`)

- **Queue:** the list page writes its filters and page into each ticket link (`src/lib/ticket-queue.ts`). The ticket
  page loads the same list again to offer previous/next, "3 of 25" (with "+" when more pages follow) and the j/k keys.
  Default list links stay clean (`/app/tickets/12`).
  - _Limit:_ previous/next stay within the loaded page of 25. The first and last tickets of a page don't link
    across pages.
- **Split view at 2xl (≥1536 px):** the list appears as a left column (`nav "Tickets in this list"`), with the current
  ticket marked `aria-current="page"`. Pages opt into a wider `main` with `data-wide` (max-w-7xl), or
  `data-wide="xl"` (100 rem at 2xl).
- **Conversation as a timeline:** an avatar per author (customer neutral, agent brand, internal note amber) and a
  connecting line. Internal notes keep the words "Internal note, not visible to the customer".
- **Triage card:** "Confidence" is now labelled **Self-rated confidence**. It is the model's own estimate, which the
  app compares with the auto-apply threshold. It is not a measured accuracy.

## AI draft card (`draft-panel.tsx`, `draft-view.tsx`)

| Part             | Design                                                                                                                                                                                                                        | Why                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Header           | "AI draft · {model}"                                                                                                                                                                                                          | Microsoft HAX G11: make clear why the system did what it did           |
| Automatic checks | Chips from server facts (`src/lib/draft-checks.ts`): cites N sources, every citation matches, no unfamiliar links; failures for hidden characters, truncation and changed sources. The detailed warning box stays below them. | Google PAIR: avoid raw model percentages; show checkable facts         |
| Citations        | Numbered chips. Hover or keyboard focus shows a passage preview (Base UI Tooltip, no ARIA role); a click opens the full passage in the source list.                                                                           | Intercom Copilot-style passage preview; HAX G2                         |
| Actions          | Approve & send, Edit, Regenerate, Discard                                                                                                                                                                                     | HAX G9: easy to correct; G8: easy to dismiss                           |
| Regenerate       | Discards the current draft through the existing endpoint, then streams a new one. If the agent has edited it, a second click is needed ("Discard edits and regenerate").                                                      | No backend change; edits are never lost silently                       |
| Refusal          | Its own card: "Insufficient knowledge…", the reason, "The AI does not guess…", plus **Add a help article** (only for roles that may) and **Write the reply yourself**.                                                        | HAX G1/G2: be clear about what the system can't do; show the next step |
| Streaming        | "Searching your knowledge base and writing…" with a pulse dot (static with reduced motion)                                                                                                                                    | HAX G3: timing of the service                                          |

## Keyboard

All single-key shortcuts pause while typing and inside menus and dialogs (`pageKeyFor` in `src/lib/shortcuts.ts`,
hook `src/lib/use-page-shortcuts.ts`). Each one also has a visible button, and the "?" sheet lists them in three groups.

| Keys | Where       | Action                                                                |
| ---- | ----------- | --------------------------------------------------------------------- |
| J/K  | Ticket list | Focus the next/previous row; Enter opens it                           |
| J/K  | Ticket      | Next/previous ticket of the list you came from                        |
| E    | Draft ready | Open or close the editor (the cursor goes to the end)                 |
| A    | Draft ready | **Focus** Approve & send and show "Press Enter to send…"; Enter sends |
| R    | Draft ready | **Focus** Regenerate; Enter confirms                                  |

A and R only move focus: sending an email to a customer always takes a second, deliberate key press.

## Tests

- Unit: `tests/unit/inbox.test.ts` (relative time, queue links and neighbours, draft checks, excerpts, page keys) and
  a regression test for the raw-palette guard. The guard now also catches side and state variants
  (`border-l-blue-700`, `ring-offset-black`); it found two raw colours, which were replaced with tokens.
- E2E: list j/k and Enter, ticket j/k, the previous button and "1 of 2" (`agent-inbox.spec.ts`). Draft checks,
  citation preview on hover and keyboard focus, E/A/Enter, R/Enter regenerate and the refusal link (`drafts.spec.ts`).
  The Needs review quick filter (`triage.spec.ts`). axe in light and dark on the full list, a ready draft, the
  citation preview and the shortcut sheet.
