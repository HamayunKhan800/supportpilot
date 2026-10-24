# Public pages

Design system step 5 (`docs/plans/design-system.md` §7): the landing page, sign-in and sign-up,
workspace setup, invitations, the customer portal, the private tracking page and the 404 page.

## Inspiration, and what was not copied

- **Linear**: one headline and one supporting line; the product shown as real interface fragments
  rather than a screenshot or an illustration.
- **Plain**: small capital section labels, one plain heading and one paragraph per section.
- **Vercel (Geist)**: split sign-in layout, forms on the page rather than inside a card.
- **Intercom / hosted help centres**: the customer portal carries the support team's name, with
  "Powered by" in the footer.

Not copied: customer logos, testimonials, invented numbers, decorative grids or gradients, window
"traffic light" dots, or any third-party asset. The logo is an original SVG (a reply bubble with a
check, for "a reply a person approved").

## Landing page (`src/app/page.tsx`)

- **Hero**: what the product does, then a muted second sentence for the human-approval rule. Calls
  to action: create a workspace and read the code.
- **Product preview** (`components/marketing/product-preview.tsx`): static HTML built from the
  app's own tokens and labels, with demo content from the Nimbus help centre (the refund policy and
  cancellation articles it cites exist in `eval/corpus/nimbus/`). It is `aria-hidden` and described
  by a caption. It is HTML rather than an image because `next/image` adds inline styles, which the
  CSP blocks.
- **How it works**: four numbered steps (triage, retrieve, draft, approve).
- **Evaluation**: four numbers from the latest Gemini run (`src/lib/landing.ts`), each with its
  sample size and 95% confidence interval, and a note that says what the run did not cover (it
  stopped at 319 of 420 items, most drafts came from the fallback model, two suites have no data).
  Update `landing.ts` when a new report is written.
- **Engineering**: six claims, each one checkable in the repository. No test counts and no claim of
  a finished security review.

## Sign-in, sign-up, setup, invitations (`components/auth-shell.tsx`)

The form on the left; on wide screens a muted panel with a compact product preview and one sentence
("Every AI reply cites its sources and waits for a person's approval"). Workspace setup shows the
portal address as you type the workspace address, and who is signed in.

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
