# Design quality checks

Design system step 6 (`docs/plans/design-system.md`): proof that the new design holds up, and the
checks that keep it that way.

## Visual regression (`tests/e2e/visual.spec.ts`)

Playwright screenshot comparisons of the key screens, run with the rest of the end-to-end suite
(locally and in CI) against the production build.

| Screen                  | Desktop light | Desktop dark | Phone (Pixel 7) light |
| ----------------------- | :-----------: | :----------: | :-------------------: |
| Landing page            |   full page   |     yes      |          yes          |
| Sign in                 |      yes      |     yes      |          yes          |
| 404                     |      yes      |     yes      |          yes          |
| Customer portal         |      yes      |      no      |          yes          |
| Inbox                   |      yes      |     yes      |          yes          |
| Ticket with an AI draft |      yes      |     yes      |          yes          |
| Customer tracking page  |      yes      |     yes      |          yes          |

20 baselines in `tests/e2e/__screenshots__/{desktop,mobile}/` (about 1.3 MB).

How the screenshots stay the same from run to run:

- fixed workspace, article and ticket text, and the deterministic mock AI provider;
- every `<time>` gets the same text (its width could otherwise change how a line wraps) and is
  masked;
- the pointer is parked in a corner, so no hover styles show; Playwright turns animations off and
  takes each screenshot again until two in a row match;
- a tolerance of 1 % of pixels (`maxDiffPixelRatio: 0.01`) absorbs anti-aliasing noise. The one
  real failure found while building this, a line that wrapped differently, changed 4 % of pixels.

After an intended design change, run `pnpm build && pnpm test:visual:update` and review every changed image
before committing it.

**Limitation:** the baselines were made on Debian 13 with Playwright's bundled Chromium; CI runs
Ubuntu with the same Chromium build and the same self-hosted fonts. If the first CI run shows
differences that are only font smoothing, the baselines will be regenerated from the CI images
(the HTML report includes them) rather than raising the tolerance.

## Keyboard-only walkthrough (`tests/e2e/keyboard.spec.ts`)

1. **Every Tab stop** on the landing, sign-in, sign-up and 404 pages, forwards and (on the landing
   page) backwards: the focused element must look different from its unfocused state (WCAG 2.4.7
   Focus Visible) and must not be covered by anything, such as the sticky header (WCAG 2.4.11
   Focus Not Obscured). The check finishes focus-ring transitions before comparing, and a temporary
   probe that stripped one field's focus styles confirmed it reports a missing indicator.
2. **An agent's whole job with the keyboard alone**: the skip link is the first stop; Tab and type
   to sign in; Ctrl/⌘ K, "Tickets", Enter; J and Enter to open the first ticket; Tab to Generate
   draft and Enter; E to edit and add a sign-off; Tab to Done editing; A to move to Approve & send
   and Enter to send. Every Tab stop along the way gets the same focus check. Setup (account,
   workspace, article, ticket) happens in a separate browser context first.

Desktop only: the phone project has no hardware keyboard.

## Lighthouse (landing page, production build)

Lighthouse 13.5.0, run locally against `node scripts/start-standalone.mjs` on 2026-10-24.
Mobile uses Lighthouse's default simulation (a mid-range phone on a slow 4G connection).

| Run                  |   Performance   | Accessibility | Best practices | SEO |
| -------------------- | :-------------: | :-----------: | :------------: | :-: |
| Desktop              |       100       |      100      |      100       | 100 |
| Mobile (median of 3) | 89 (85, 89, 91) |      100      |      100       | 100 |

Mobile details (median run): First Contentful Paint 1.0 s, Largest Contentful Paint 3.4 s,
Total Blocking Time 190 ms, Cumulative Layout Shift 0. The largest element is the headline text;
it appeared about 0.4 s after the request without throttling. The remaining cost is
the React and Next.js runtime every page loads (the page's own client code is only the theme
switch), so there is no cheap fix; a static export of the landing page would be the next step if
this mattered more.

These are local numbers, not field data from real users.
