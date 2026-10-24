# Public pages

Design system step 5 (`docs/plans/design-system.md` §7), revised in design step 10
(`docs/plans/premium-polish.md`): the landing page, sign-in and sign-up,
workspace setup, invitations, the customer portal, the private tracking page and the 404 page.

## Inspiration, and what was not copied

Measured on the live sites (October 2026) before each change; ideas were adapted, nothing copied.

- **Linear**: a left-aligned headline whose words arrive blur-to-sharp, over the working product;
  a translucent, blurred header.
- **Vercel / Clerk / Resend**: a living background behind the hero (they use WebGL or canvas; ours
  is a 2D canvas dot field). Sign-in as one narrow, centred column.
- **Plain / Attio**: frosted (blurred, translucent) panels and menus, used where something floats
  over content.
- **Intercom / hosted help centres**: the customer portal carries the support team's name, with
  "Powered by" in the footer.

Not copied: customer logos, testimonials, invented numbers, third-party assets or paid fonts. The
logo ("Handoff": a circle passing to a square) is an original SVG.

## Landing page (`src/app/page.tsx`, `components/marketing/landing/`)

- **Hero**: the headline, word by word (blur to sharp, 300 ms each, staggered; no opacity change,
  so the largest paint is not delayed). Behind it, `hero-field.tsx`: a canvas of dots on the
  grid that brighten and lift around the pointer (a slow drift without one) and a few lights
  travelling along the grid lines. It starts when the browser is idle, pauses off screen and in
  background tabs, draws nothing with reduced motion, and is hidden from assistive technology.
  Below it, `hero-live.tsx` plays the real inbox flow and lets the visitor take over.
- **Sections** (how it works, guardrails, the customer's side, team tools, evaluation,
  engineering): each a working fragment of the product rather than a screenshot. Section headings
  sharpen from a blur as they scroll in; the main cards carry a soft light on the border that
  follows the mouse (`spotlight.tsx`, mouse only).
- **Evaluation numbers** come only from `src/lib/landing.ts` (the latest Gemini baseline,
  `docs/eval/m6-baseline.md`), each with its sample size and 95% interval.
- **Glass**: the header and floating panels use the `glass` / `glass-bar` utilities in
  `globals.css` (translucent with a backdrop blur, solid where blur is unsupported). The header is
  88% opaque so its links keep their contrast over light sections.

## Sign-in, sign-up, setup, invitations (`components/auth-shell.tsx`)

One narrow, centred column on a frosted card, over a quiet version of the landing page's dot field
(no travelling lights). On a phone the card frame is dropped and the form uses the full width. No
demo or marketing beside the form, as on Linear, Vercel, Resend, Plain, Attio and Clerk. Workspace
setup shows the portal address as you type the workspace address, and who is signed in.

## Customer portal and tracking page (`components/portal/portal-frame.tsx`)

- The frame shows the workspace's initials and name; header, content and footer share one width.
- **Portal**: the form and a "What happens next" list, which says plainly that replies may be
  drafted with AI help and that a person reviews each one before it is sent. The note about
  sensitive data sits next to the submit button.
- **Tracking page**: the request number, subject, status with a one-line explanation, and the
  conversation as a timeline. Customer messages are labelled "You" and support messages
  "Name (support team)": the difference never relies on colour. The page still sets `noindex` and
  `no-referrer`, and never shows the team's notes or the customer's email.

## Tests

- `accessibility.spec.ts` scans the 404 page, and the portal, tracking, invitation and 404 pages in
  the dark theme, as well as the existing light-theme scans. All have zero serious violations.
- The existing role-based selectors (labels, button names, headings) are unchanged.
