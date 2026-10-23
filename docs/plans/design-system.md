# Plan: design system and UX overhaul ("M6.5")

Status: **proposed, waiting for the owner's approval.** No application code is written until it is approved.

## 1. Why

SupportPilot works, is tested and is accessible, but it looks like an unstyled shadcn/ui starter. An employer opening the live demo judges the product in the first few seconds. The design should look as deliberate as the engineering behind it.

### Audit of the current UI (2026-10-23)

| Area                            | Today                                                                                     | Problem                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Colour                          | shadcn `neutral` defaults: every token is grey (`oklch(L 0 0)`), even the 5 chart colours | No brand, no hierarchy from colour, and the charts are hard to tell apart |
| Type                            | System font stack, no type scale                                                          | Looks generic; headings, labels and data share one voice                  |
| Layout                          | Top header with up to 9 nav links that wrap; content capped at `max-w-5xl` (1024 px)      | An inbox app wastes most of a desktop screen; the nav wraps on laptops    |
| Components                      | 7 primitives (alert, badge, button, card, input, label, textarea)                         | No menus, dialogs, tooltips, tabs, skeletons, toasts or command palette   |
| AI surfaces                     | The draft, citations and refusal are shown as plain cards and lists                       | The most important screen does not show _why_ to trust a draft            |
| Themes                          | Dark tokens exist but there is no toggle                                                  | Dark mode is half-finished                                                |
| Speed of use                    | Mouse only                                                                                | Support agents live in the inbox and expect keyboard shortcuts            |
| Empty, loading and error states | Plain text                                                                                | Feels unfinished                                                          |

## 2. Research: what the best products do, and what we borrow

Each idea is adopted because it solves a problem above. We take inspiration, not assets: no copied logos, illustrations or proprietary fonts.

| Source                                                                                                                                                                         | What they do                                                                                                                                                                                                                                                                                                                               | What SupportPilot adopts                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Linear**, "How we redesigned the Linear UI" ([linear.app](https://linear.app/now/how-we-redesigned-the-linear-ui))                                                           | Themes generated from **3 variables (base colour, accent colour, contrast)** instead of 98 hand-picked ones, in a perceptually uniform colour space (LCH). They limited how much accent "chrome" goes into neutrals for a timeless look, and darkened text for contrast. The "inverted L" chrome (sidebar plus header) frames the content. | One accent hue and one contrast setting generate all tokens in **OKLCH** (the CSS successor to LCH, which Tailwind 4 and shadcn already use). Neutrals carry a hint of the accent hue. Sidebar plus header shell.                                                                                                             |
| **Radix Colors**, "Understanding the scale" ([radix-ui.com](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale))                                 | **12 steps, each with a job**: 1–2 backgrounds, 3–5 component states (normal, hover, pressed), 6–8 borders and focus rings, 9–10 solid fills, 11–12 text.                                                                                                                                                                                  | Our scales follow the same step roles, so "which grey?" is never a guess. Hover is always one step darker.                                                                                                                                                                                                                    |
| **Vercel Geist** ([vercel.com/geist/colors](https://vercel.com/geist/colors))                                                                                                  | Disciplined greys, 10 colour scales, colour reserved for status. The open-source **Geist Sans and Geist Mono** fonts: mono for data and IDs.                                                                                                                                                                                               | Geist Sans for UI and Geist Mono for ticket numbers, IDs, timings and costs, self-hosted with `next/font` (no runtime request to Google, so it works with our CSP). A 4 px spacing grid and a compact type scale.                                                                                                             |
| **Plain** (support tool, [plain.com](https://www.plain.com/blog/customer-support-software))                                                                                    | A **keyboard-first** support inbox with a fast UI; statuses change from a quick-action bar below the composer (shortcut **S**) ([changelog](https://www.plain.com/changelog/new-support-queue-statuses-in-plain)).                                                                                                                         | A **⌘K / Ctrl K command palette**, `j`/`k` to move through tickets, `e` to edit the draft, `a` to approve, `s` for status, with a `?` shortcut sheet. Every shortcut also has a visible button.                                                                                                                               |
| **Intercom Fin AI Copilot** ([intercom.com](https://www.intercom.com/blog/announcing-fin-ai-copilot/), [help](https://www.intercom.com/help/en/articles/9121381-copilot-faqs)) | Shows the sources behind each answer, **previewable inside the inbox**, with **the exact passage highlighted**; "Add to composer" with tone options.                                                                                                                                                                                       | **Inline citation chips** in the draft (`[1]`). Hover or tap shows the exact chunk that was retrieved; click opens the article side panel with that passage highlighted. Approve, edit, regenerate and refuse states are clearly labelled.                                                                                    |
| **Microsoft HAX guidelines** (CHI 2019, 18 guidelines, [microsoft.com](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/))                                             | Evidence-based rules: G1 _make clear what the system can do_, G2 _how well_, G9 _support efficient correction_, G11 _make clear why_, G15 _granular feedback_.                                                                                                                                                                             | G1: an "AI draft" label and a one-line scope note. G2: show our **measured** eval numbers (citation validity, refusal rate) on the analytics page. G9: edit in place and one-click regenerate. G11: citations plus the "why it refused" reason. G15: 👍/👎 with a reason on each draft (already stored as approve or reject). |
| **Google PAIR Guidebook**, Explainability + Trust ([pair.withgoogle.com](https://pair.withgoogle.com/chapter/explainability-trust/))                                           | Aim for **calibrated** trust, not maximum trust. Explain for understanding, not completeness. Show confidence as categories only if it matches real quality.                                                                                                                                                                               | No fake confidence percentages. We show **facts we can check**: how many sources, whether every claim is cited, and whether the retrieval score passed the 0.62 threshold. A refusal says why.                                                                                                                                |
| **shadcn/ui, October 2026: AI Elements** ([ui.shadcn.com](https://ui.shadcn.com/docs/changelog))                                                                               | New open-source patterns for AI interfaces, among them _Inline Citation_, _Sources_, _Confirmation_, _Message_ and _Suggestion_, plus components such as Sidebar, Command, Kbd, Empty, Skeleton and Toast.                                                                                                                                 | We already use shadcn (`base-nova` style, Base UI). We add only the components we need through the CLI and review each generated file like our own code.                                                                                                                                                                      |
| **WCAG 2.2** ([w3.org](https://www.w3.org/TR/WCAG22/))                                                                                                                         | New AA rules: **2.5.8 Target Size, at least 24×24 px**, and **2.4.11 Focus Not Obscured** (focus must not hide under sticky headers).                                                                                                                                                                                                      | Every new control is ≥24 px (most 32–36 px). Sticky header and sidebar use `scroll-padding`. Keep zero axe violations, now in **both** themes.                                                                                                                                                                                |

## 3. Design direction: "calm, dense, trustworthy"

- **Calm:** neutral surfaces. Colour means something: accent for actions and focus, green/amber/red/blue only for status. No decorative gradients in the app.
- **Dense:** an inbox shows many tickets without scrolling. 14 px body text, 32 px rows, full-width layout on large screens.
- **Trustworthy:** every AI output is labelled, cited and editable, and the numbers on screen are our real measured results.
- **Flat by default, raised only when floating** (Linear's rule): cards and panels use borders; only menus, dialogs, popovers and the command palette get shadows and larger radius.

## 4. Design tokens (foundation)

- **Colour:** generated in OKLCH from `--accent-hue`, `--accent-chroma` and a `contrast` mode. 12-step roles for `gray`, `accent`, `success`, `warning`, `danger` and `info`. These map onto the existing shadcn tokens (`--primary`, `--muted`, `--border`, `--ring`, `--chart-1..5`, `--sidebar-*`), so all current components restyle without rewrites.
- **Contrast tested in code:** a unit test computes WCAG contrast for every text/background pair in both themes and fails CI below 4.5:1 for text and 3:1 for UI borders and focus rings.
- **Type:** Geist Sans 400/500/600 and Geist Mono 400/500. Scale: 12/16 label, 13/18 small, 14/20 body, 16/24 large, 20/28 title, 24/32 page heading, 32/40 marketing only.
- **Spacing:** a 4 px grid. **Radius:** 6 px controls, 8 px cards, 12 px floating layers.
- **Motion:** 120–200 ms ease-out for menus and panels only, and none with `prefers-reduced-motion`.
- **Charts:** 5 distinct, colour-blind-safer hues taken from the status and accent scales, plus direct labels, so colour is never the only cue.

## 5. Scope, screen by screen

1. **App shell:** a collapsible left **sidebar** with icons, grouped (Work: Inbox, Knowledge; Insights: Analytics, Evaluation; Admin: Members, AI settings, Audit) and a count badge on Inbox. A workspace switcher at the top and a user menu at the bottom (account, theme, sign out). The command palette opens with ⌘K. On mobile the sidebar becomes a drawer, and the header gets a menu button (this fixes the "mobile header" M7 gap).
2. **Inbox (tickets):** dense rows with a status dot, priority icon, category tag, customer, age and "AI draft ready" marker. Filter chips plus saved views (Open, Mine, Needs review). On wide screens a **split view**: list on the left, ticket on the right, `j`/`k` to move.
3. **Ticket detail and AI draft (the showcase screen):** the conversation thread on the left, the **draft composer** below it, and a properties panel on the right (status, priority, category, assignee, triage reasoning). The draft card shows:
   - an "AI draft · model name" label;
   - inline citation chips with hover previews of the exact chunk;
   - a "3 sources · all claims cited" check row;
   - Edit, Approve and send, Regenerate and Discard;
   - a distinct refusal state ("No help article covers this, so no draft was written"), with a link to add an article.
4. **Knowledge:** document cards with ingestion status (processing, ready, failed), and search results with the matching passage highlighted and the score shown against the threshold.
5. **Analytics and evaluation:** KPI cards with sparkline and change; coloured, labelled charts; the eval page shows each target as a pass or fail chip with its 95 % interval and an "AI-graded" note where it applies.
6. **Settings, members, audit, account:** consistent page headers, form sections with descriptions, confirmation dialogs for destructive actions, toasts for success.
7. **Public pages:**
   - a real **landing page** with a hero, product screenshot, a "how it works" section (triage → retrieve → draft → human approves), honest measured numbers and a link to the GitHub repo;
   - a split-layout sign-in and sign-up;
   - a cleaner customer portal and onboarding.
8. **States everywhere:** skeletons while loading, helpful empty states with a next action, and error states with a retry and support ID (ties into Sentry).

## 6. Steps (one at a time, each committed locally, like M6)

| Step                       | Delivers                                                                                                                                  | Proof it works                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. Foundations             | Tokens, Geist fonts, light/dark/system theme toggle (no flash on load), contrast unit test, a token reference in `docs/design/`           | Unit tests, axe in both themes, existing E2E green                                              |
| 2. App shell               | Sidebar, mobile drawer, user menu, command palette, shortcut sheet                                                                        | New E2E for keyboard navigation and the mobile drawer; axe                                      |
| 3. Inbox and ticket detail | Split view, new rows, draft card with inline citations, refusal state, shortcuts                                                          | E2E for approve, edit and regenerate by keyboard and pointer; unit tests for citation rendering |
| 4. Remaining app pages     | Knowledge, analytics, evaluation, settings, members, audit, account                                                                       | E2E plus axe on every page                                                                      |
| 5. Public pages            | Landing, auth, portal, onboarding                                                                                                         | E2E plus axe; Lighthouse check of the landing page                                              |
| 6. Polish and proof        | Playwright **visual regression** baselines (light, dark, mobile) for key screens, a keyboard-only walkthrough, new screenshots and README | All gates green; screenshots are taken from the production build                                |

## 7. Rules and non-goals

- No new heavy dependencies: no animation library and no CSS-in-JS. Fonts are self-hosted. Each new package needs a clear purpose and an audit.
- Backend, API and data model are unchanged, apart from wiring that already exists (for example, unread counts for the badge).
- Existing role-based E2E selectors stay (`getByRole` and `getByLabel`), so tests check behaviour, not looks.
- Screenshots and the README come **after** this milestone, so the portfolio shows the new design.
- Honest copy: no invented customer logos, testimonials or numbers. Any number shown comes from our eval reports.

## 8. Decisions needed from the owner

1. Approve this plan, so step 1 can start.
2. Accent colour: see `docs/design/preview.html` (Iris, Teal or Amber). Default proposal: **Iris** (blue-violet).
3. Default theme: follow the device setting (proposal), or always light or always dark.
