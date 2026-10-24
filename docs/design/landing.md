# Landing page (redesign, 2026-10-24)

The owner asked for a premium, distinctive landing page after studying the homepages of Plain,
Pylon, Intercom, Linear and Resend (and Vercel, Help Scout, Raycast, Stripe, Framer, Attio,
Gorgias, Zendesk). This note records what was taken from them, what was deliberately not, and
how the page stays honest, accessible and fast. Code: `src/app/page.tsx` and
`src/components/marketing/landing/`; styles at the end of `src/app/globals.css`.

## What the references do well, and what this page takes

| Reference | Pattern studied                                                                                                                               | Used here as                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Linear    | Left-aligned two-line headline; a full-width, realistic three-pane app as the hero; a floating agent panel layered over it; two-tone headings | The hero composition (sidebar, inbox, ticket, details) with floating Sources and live-notice panels |
| Plain     | A problem statement before features; dark and light bands alternating; a dark "AI" band of small UI tiles                                     | The "Most answers already exist" statement, ink bands, the guardrails bento                         |
| Resend    | Real code as the picture; an event log; a light ray over a dark hero                                                                          | The real API request/response panel; the model-call log tile; the white glow (ink only)             |
| Pylon     | Interactive walkthrough of the workflow                                                                                                       | The four-stage tabs, each with its own product scene                                                |
| Intercom  | AI suggestion and human approval shown together in the inbox                                                                                  | The draft with its checks next to "Approve & send"                                                  |
| Raycast   | Keyboard-first story with real shortcuts                                                                                                      | The command palette scene with the app's real shortcuts                                             |
| Stripe    | Precise data presentation                                                                                                                     | The evaluation table with range bars on a true 0–100% scale                                         |

Not taken: customer-logo walls and testimonials (there are none, so none are shown), big-number stat
strips, gradient text, coloured glows, pricing, and a video hero.

## Structure

1. Hero (ink band): headline, one sentence, two calls to action, the evaluation link, the product
   composition, and the "Built with" list (technologies the project really uses).
2. Problem: a large two-tone statement, then "the usual way" against "with SupportPilot", row by row.
3. How it works: tabs for Triage, Search, Draft, Review and send; each scene replays its entrance.
4. Guardrails (ink band): four tiles of different sizes with the app's own warning and refusal texts.
5. Customers: two layered phones (support form and tracking page) beside the text.
6. The team: command palette scene, then six capabilities in a plain grid (no icon-in-a-square).
7. Evaluation: the measured results with 95% intervals; a stacked list on phones.
8. Engineering: a checklist beside a real endpoint from the OpenAPI description.
9. Closing (ink band) with the Handoff mark drawn large as line art, then the footer.

## System

- Colour: ink only. Bands set `data-theme="dark"` on the section, so the generated dark tokens
  (and `dark:` utilities) apply inside them; `--band-bg` is a little darker than the dark page, so
  bands still read as bands in dark mode.
- Type: Geist. Display 76 px / 1.02 / −0.045em; section headings 40 px / 1.1 / −0.03em; lead 18 px.
- Depth: one window shadow (`land-shadow`) and one panel shadow (`land-shadow-sm`); borders do the rest.
- Texture: a faint 56 px grid fading from the top of the hero, dots behind showcase scenes.

## Motion

- Hero: the headline and intro are static. They are the largest paint, and a fade-in would hold
  back Largest Contentful Paint until hydration (mobile Lighthouse fell to 76 when they faded).
  The window rises, the draft appears line by line, then its checks, actions and the two
  floating panels. One-shot, each step 260–280 ms, ease-out (`cubic-bezier(0.23, 1, 0.32, 1)`).
- Scroll reveals (`data-reveal`): a 12 px rise and fade, 300 ms, once. The script marks
  `<html data-reveal>` only after revealing what is already on screen, so nothing visible blinks,
  and nothing is hidden without JavaScript.
- Hover: colour and border transitions only. Tabs replay their scene's entrance on change.
- Reduced motion: every landing animation and reveal is off (delays included).
- No animation library, no inline styles (the CSP stays strict), no animated charts.

## Honesty rules applied

Every number is either a measured result with its sample size (from `src/lib/landing.ts`) or
labelled demo data inside a product picture. Product pictures use the app's real wording; claims
were checked against the code (for example: drafts are written when an agent clicks Generate
draft, not automatically; the 95% auto-apply threshold is a per-workspace default; the palette
jumps to pages and tickets but does not search articles).

## Verification

`tests/e2e/landing.spec.ts` (desktop and phone): calls to action, section links, tabs by mouse and
keyboard, reveals, reduced motion, no sideways scrolling, no CSP errors. axe runs on the settled
page in both themes (`settle()` in `tests/e2e/fixtures.ts` scrolls once and waits for animations).
`tests/unit/landing-eval.test.ts` keeps the range bars in step with the numbers.

Lighthouse 12 (local production build, 24 Oct 2026): desktop 100 in all four categories; mobile
performance 89, 83 and 86 over three runs, the other three 100. Unthrottled, the headline is the
first and largest paint at 0.29 s; the simulated phone score is held back by hydration (total
blocking time 280–340 ms). About a quarter of the phone DOM is desktop-only detail hidden with CSS;
removing it would mean duplicate components or JavaScript layout switching, so it stays.
