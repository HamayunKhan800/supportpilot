# Plan: feedback, loading states and motion (design step 8)

Status: **approved 2026-10-24 (all seven steps; push after step 8).** Progress: all seven steps done.

## 1. Why

The owner tried the app on a phone (2026-10-24, mock AI, Cloudflare Quick Tunnel) and found it "very static,
boring, not dynamic, live or smooth: no animations, loading spinner, errors, placeholders, toasts".

An audit of the code confirms it:

| Area                 | Today                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moving between pages | Pages are rendered on the server per request, and nothing happens on screen until the new page arrives. On a phone network this reads as "frozen".                        |
| Loading placeholders | None. A route `loading.tsx` was tried and removed: React streamed a chart part as `<svg style="display:none">`, which the strict nonce CSP blocks (docs/design/pages.md). |
| Toasts               | A Base UI toaster exists, but only the Members page uses it. Approve & send, uploads, status changes and settings saves give no confirmation.                             |
| Pending states       | 15 components show pending text on their own button ("Saving…"). One spinner (knowledge status), one pulse.                                                               |
| Motion               | Colour transitions, the mobile drawer slide and the toast slide. Menus, dialogs, new list items and new replies appear instantly.                                         |
| Live data            | None. A new ticket or customer reply appears only after a manual reload.                                                                                                  |

## 2. What the research says (and what we take from it)

- **Feedback must match the wait** (Nielsen Norman Group): under 0.1 s, show nothing; 0.1–1 s, at most a subtle sign;
  1–10 s, a spinner or skeleton; over 10 s, progress with an explanation. Skeletons fit full-page loads, and spinners fit
  one module. Sources: nngroup.com/articles/response-times-3-important-limits, /articles/progress-indicators,
  /articles/skeleton-screens.
- **Motion needs a purpose, must be fast, and frequent actions get none** (Emil Kowalski, Vercel and Linear design
  engineer, author of Sonner): UI animations under 300 ms, ease-out for things entering, and no animation for
  keyboard-triggered actions or anything seen hundreds of times a day. Press feedback 100–160 ms, popovers
  125–200 ms, dialogs and drawers 200–500 ms. Sources: emilkowal.ski/ui/you-dont-need-animations,
  /ui/7-practical-animation-tips, github.com/emilkowalski/skills.
- **Feel instant by not waiting** (Linear): changes apply on screen first and sync in the background; libraries or
  React's own tools get close with optimistic updates. Source: performance.dev/how-is-linear-so-fast-a-technical-breakdown.
- **Next.js tools for this** (official docs): `useLinkStatus` gives a link's pending state; delay the hint by about
  100 ms so fast navigations don't flicker. Source: nextjs.org/docs/app/api-reference/functions/use-link-status.
- **Respect "reduce motion"** in the operating system: every animation turns off with `prefers-reduced-motion`.

## 3. Rules for this step

- No new dependencies: CSS transitions, Base UI's `data-starting-style` and `data-ending-style`, React `useOptimistic`
  and `useTransition`, and Next.js `useLinkStatus`. No animation library.
- CSP stays strict: no inline styles and no `unsafe-inline`. Zero CSP violations in the E2E check.
- Calm, not flashy: no bouncing, no animated charts, no fade-up on every section. Nothing blocks input.
- Accessibility: status changes are announced (polite live regions; errors assertive); motion off under
  reduced motion; axe 0 violations in both themes.
- Honest: a spinner or skeleton only while something is really happening, and no fake progress percentages.

## 4. Steps (one at a time, each committed locally)

| Step                    | Delivers                                                                                                                                                                                                                                                                                          | Proof                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 8.1 Navigation feedback | A thin ink progress bar at the top whenever a page is loading (appears only after ~120 ms, so fast pages don't flicker); the tapped sidebar item, tab or ticket row shows it is loading. Investigate route skeletons safely: only if the CSP problem can be solved without loosening the policy   | E2E: bar appears on a slowed navigation and is gone after; CSP check; reduced-motion check |
| 8.2 Toasts for actions  | Short confirmations with an action where useful: "Reply sent to Casey", "Status changed to Pending · Undo", "Upload queued", "Settings saved", "Invite link copied", "Suggestion accepted". Errors show a clear message and a Retry where it makes sense                                          | E2E per action; screen-reader announcement checked                                         |
| 8.3 Instant updates     | Status, priority, category and assignee change on screen immediately (optimistic), and roll back with an error toast if the server refuses                                                                                                                                                        | E2E for success and for a forced failure (rollback)                                        |
| 8.4 Live data           | The inbox, ticket page and knowledge list refresh themselves while the tab is visible (every ~15 s, paused in background tabs): a "2 new tickets" pill, new customer replies appearing in the conversation, document status moving from Processing to Ready                                       | E2E: a portal request appears in an open inbox without reload                              |
| 8.5 Motion polish       | Menus, popovers and dialogs fade and scale in (150–200 ms, ease-out); buttons give press feedback; new list items, replies and the AI draft fade in; skeleton lines while a draft starts and while test search runs; sidebar collapse animates. Command palette and keyboard actions stay instant | Visual baselines; reduced-motion E2E; no layout shift                                      |
| 8.6 Error and offline   | One consistent error panel with Retry; an "You're offline" banner when the connection drops; form errors inline and focused                                                                                                                                                                       | E2E with the network cut                                                                   |
| 8.7 Proof and showcase  | Full test run, axe in both themes, Lighthouse not worse, fresh screenshots, and a short screen recording (GIF) for the README so employers can see it moving                                                                                                                                      | All gates green                                                                            |

## 5. Not doing (and why)

- A Linear-style local database and sync engine: a large architecture change for a portfolio app; optimistic updates
  get most of the feel.
- Page-transition animations between routes and animated charts: they slow people down and hinder reading data.
- WebSockets for live data: polling every 15 s while visible is simpler, fits the current hosting plan (M8), and can be
  swapped for server-sent events later.

## 6. Progress notes

- **8.1 done.** `src/lib/navigation-progress.ts` (store and pure click/URL rules, 12 unit tests),
  `src/components/navigation-progress.tsx` (mounted in the root layout), `src/lib/use-progress-router.ts` (used by the
  10 places that change page from code), sidebar icon pulse via `useLinkStatus`, CSS in `globals.css`.
  E2E `tests/e2e/feedback.spec.ts` now also runs on the mobile project. Links to `/api/` and `download` links are
  ignored, and the bar gives up after 15 s, so it can't get stuck.
- Build note: a stale Turbopack cache in `.next/cache` once served an old stylesheet after `globals.css` changed.
  Delete `.next` before building when CSS changes.
- **8.2 done.** `notify()` takes an action ("Undo", "Open") and an `info` tone (`src/lib/toast.ts`, `toaster.tsx`).
  New confirmations only where the page showed nothing: accepting the AI suggestion, re-processing a document, and every
  ticket-detail change. Actions that already confirm on the page (reply sent, note added, settings saved, upload
  queued, draft feedback) keep that message: no duplicates.
- **8.3 done.** Ticket details save on change, without a Save button (`tickets/[number]/properties.tsx`). Saves run
  one at a time, each with the version the previous one returned; a refused change is put back and explained;
  each change offers Undo; closing asks first (it is final) and has no Undo. `ConfirmDialog` gained a controlled
  mode. The panel is keyed by ticket only and adopts server values when someone else raised the version.
- **8.4 done.** `<LiveRefresh />` (`src/components/live-refresh.tsx`) re-renders the inbox, overview and ticket pages
  every 15 s while the tab is visible, and at once on returning to the tab; it skips while someone types, chooses
  in a select, or has a dialog open. News is a quiet toast: "New ticket #26 · Open" and "Casey Customer replied"
  (`src/lib/live-notice.ts`, 6 unit tests). A notice carries an order that only grows, so closing the newest
  ticket is never announced as new. Knowledge already refreshed itself while documents process.
- **8.5 done.** Menus, the tooltip, dialogs, the drawer and toasts already animated (150–200 ms), and buttons already
  had press feedback. Added: new conversation messages, inbox rows and draft results fade in (180 ms, only for items
  added after the page became interactive, via `@starting-style`); skeleton lines while a draft starts and while the
  first knowledge search runs; a blinking cursor while the AI writes. The command palette stays instant.
- **8.6 done.** `<ConnectionStatus />` in the root layout: "You're offline. Changes can't be saved until the connection
  is back." and "Back online." (a polite live region, not `role="status"`, so it never competes with a page's own
  status). Failed requests already said "You appear to be offline"; both error pages already offer Try again.
- Route-level skeletons (`loading.tsx`) stay out: the CSP finding in docs/design/pages.md still applies, and the top
  progress bar covers page changes without loosening the policy.
- **8.7 done.** Full E2E run: 67 passed, 4 failed. All four were test problems (an over-broad label or button
  match, since the toast and the phone menu also contain "Priority" or "Open", plus the offline area's
  `role="status"` clashing with a page's own status message), and all were fixed. The affected specs plus axe in
  both themes were rerun: 29/29. Unit 1260/1260. Lighthouse on the landing page: desktop 100 in all four, mobile
  performance 94 (89 before; single runs vary) and 100 for the rest. 19 README screenshots retaken, and
  `docs/screenshots/app/feedback-demo.gif` (14 s, 51 frames, 1.8 MB) recorded from the app with Playwright frames
  and assembled with Pillow, at real timing. Demo data was put back afterwards.

## Design step 12: premium feedback pass (2026-10-25)

- **Loading feedback.** `Button` has a `pending` prop (spinner in place of its icon, `aria-busy`, disabled, full
  opacity); every form and async button uses it. Links being opened show a thin running line (`<LinkPending />`,
  React's `useLinkStatus`, after 120 ms). On a page change that takes over 300 ms, `<RouteBusy />` covers the old page
  with a skeleton shaped like the page being opened (client-side, so the CSP finding above still holds) and marks
  `<main aria-busy>`. A new query on the same page dims its sections after 200 ms instead; filters and search fields
  never dim. Background refreshes (`router.refresh()`) show nothing. GET forms whose script takes over are no longer
  tracked as page changes (the knowledge search used to leave the bar running until the 15 s give-up).
- **Sliding indicators.** `<SlidingIndicator />` measures the active item and slides one highlight to it (220 ms,
  ease-out, transform and size only, no inline styles in server HTML). It follows the navigation target, so the sidebar,
  tabs, period and status filters move on tap rather than when the page arrives. Without JavaScript, the static active
  styles remain. Rows, tiles and lists got 150 ms colour transitions and a pressed colour.
- **Scroll focus.** On the landing page, where `animation-timeline: view()` is supported, content below the fold starts
  blurred 6 px and 16 px low and is sharp 40% of a screen into view. No fading, so contrast never drops. Elsewhere the
  timed reveal stays; with reduced motion, nothing moves. The sticky headers already had frosted glass, so no new glass
  was added.
- Verified on a production build: 88 passed and 9 skipped across the affected specs. The only failures (axe on the
  knowledge search, caused by the form-tracking bug above) were fixed and rerun: 27/27. Unit 1290/1290; lint, types,
  formatting and gitleaks clean.
