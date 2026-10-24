# Design step 10: premium polish (hero motion, glass, dashboards, sign-in)

Status: proposed, waiting for approval. Design step 9.6 (finish) moves to the end of this plan.

## What the user asked for (2026-10-24)

1. The main heading and its background should be interactive and dynamic, as on established
   products, and the other sections too.
2. Overview, Analytics and Evaluation pages: "I don't like mine". Compare with established products.
3. Sign-in and sign-up pages: compare with established products.
4. The "premium blur, transparent effect" seen on Plain and others.

## What established products do (checked live on 2026-10-24, inspiration only)

Measured in a real browser (computed styles, element counts), not guessed.

| Product | Hero | How it moves | Blur ("glass") |
| --- | --- | --- | --- |
| Linear | Left-aligned headline over the app | 83 running animations; words arrive blur-to-sharp | Header `blur(20px)` on a transparent background |
| Vercel | Headline beside a glowing prism | WebGL `<canvas>` (1080×720) reacting to the cursor | none in the hero |
| Resend | Serif headline beside a 3D cube | `<canvas>` (648×550), cube follows the cursor | Buttons `blur(25px)` |
| Plain | Centred headline over the app, grid lines | Light; animated counter ("Tools add 8 distance") | Panels `blur(6px)` on 92% white |
| Attio | Centred headline over the app | 15 animations | Menus `blur(24px)` on 95% white; panels `blur(12px)` |
| Clerk | Headline over a live sign-in component | `<canvas>`, 5 animations | Stacked `blur(1–4px)` layers (progressive blur) |

Sign-in pages (Linear, Vercel, Resend, Plain, Attio, Clerk): **all six** use one narrow centred
column (logo, one heading, the fields). **None** shows a product demo beside the form. The
premium feel comes from the background: Resend's dark artwork, Clerk's soft gradient behind a
frosted card.

Dashboards (Stripe home, Vercel Analytics): a greeting, then **one large chart** with a few key
numbers beside it; big clickable numbers that switch the chart; ranked lists with bars; detail
tables tucked away. Ours today: a narrow column (a third of the screen empty), about a dozen
boxes of equal weight, boxes inside boxes, small charts, and fine print everywhere.

## The plan: 6 steps, each tested and committed on its own

### 10.1 Glass, used the way these products use it
Frosted, see-through surfaces only where something floats over content: the landing header,
the app's page bar, menus, the command palette, dialogs, toasts and the mobile drawer.
- `backdrop-filter: blur(16–24px) saturate(1.4)` on 70–85% backgrounds, a hairline border, a soft shadow.
- Browsers without blur get a solid background (`@supports`), so text contrast never depends on it.
- Not on ordinary cards. Frosted cards everywhere is a known "template" tell; the products above don't do it.

### 10.2 A living hero, and headings that arrive
- **Interactive background:** a field of dots on the grid, drawn on a `<canvas>` by about 3 KB of
  our own code. Near the cursor the dots brighten and lift, like a spotlight. Faint lights travel
  along the grid lines, toward the product demo. On phones it drifts gently by itself.
- **Headline:** the words arrive one after another, blur-to-sharp, like Linear's. They are
  visible from the first paint, so page-speed (LCP) isn't delayed.
- **Other sections:** each heading arrives the same way as it scrolls into view (replacing
  today's fade-up). Cards get a soft light that follows the cursor along their border.
- Rules: no library; drawing pauses when off screen or in a background tab; "reduce motion"
  shows a still picture; keyboard and screen readers are unaffected (decorative, hidden).

### 10.3 Sign-in and sign-up like Linear, Vercel and Plain
- One narrow centred column: logo, one heading, the fields; a frosted card over a quiet,
  slowly moving version of the hero background.
- The demo panel beside the form goes. The live demo stays on the landing page.
- Keeps Show/Hide, Caps Lock, the 15-character counter and every error message.
- No "Continue with Google" buttons: the app doesn't support them, so showing them would be dishonest.

### 10.4 Overview, rebuilt like Stripe's home
- Uses the full width.
- "Good evening, Olivia" plus a **Today** row: one large chart of new requests (today against
  the last 14 days), with 3 key numbers beside it.
- **Needs you:** a short action list (needs review, AI drafts waiting, urgent and unassigned),
  each line a link.
- **Recent activity:** a quiet feed. No boxes inside boxes.

### 10.5 Analytics and Evaluation, rebuilt like Vercel Analytics
- **Analytics:** big numbers across the top (Tickets, Draft acceptance, AI tokens, Cost), each
  with the change from the previous period. Clicking one switches **one large chart** below.
  Hovering (or using the arrow keys) shows the exact value for each day. Below it, ranked lists
  with bars (categories, AI features). The detailed tables sit under "Details".
- **Evaluation:** a report card at the top ("6 of 6 targets met", which run, what it cost). The
  metrics become one clean list per area (Triage, Search, Drafts, Safety): name, value, the 95%
  range as a bar, target. The trend chart is large. Method notes go under "About these numbers".
- The charts don't animate (an earlier rule). They're drawn as our own SVG, with no chart library.

### 10.6 Finish (was step 9.6)
Fresh screenshots, README update, all test suites, Lighthouse (phone at least 83, desktop 100),
secret scan. Then push when you say.

## Rules that stay
No new dependencies; strict security policy (CSP); honest copy and numbers only from the real
evaluation; zero accessibility violations in light and dark; reduced motion respected; existing
test selectors kept; no backend changes (if one turns out to be needed, I ask first).

## Risks
- The canvas costs some phone page-speed. It starts only after the page is idle, and drops to
  fewer dots on phones. If the phone score falls below 83 I scale it back.
- Blur is expensive on low-end phones. It's limited to small floating surfaces, never a full-screen layer.
