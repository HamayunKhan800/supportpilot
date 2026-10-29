# Landing page: "The cited sentence" (2026-10-29)

The third landing page. The owner asked for a complete redesign at the level of Vercel, Linear,
Stripe and Apple, with no template look, and chose this direction from six (A–F, drawn as
static comps first). Code: `src/app/page.tsx`, the client islands in
`src/components/marketing/landing/cited.tsx`, scoped styles in `src/app/landing.css` (every class
starts with `.lp-`), and the figures in `src/lib/landing.ts`.

## The argument

The product's promise is a reply in which every sentence has a source. The page makes that
promise by doing it: the headline is itself a cited sentence.

> AI drafts.<sup>[1]</sup> You approve.

The `[1]` is a working citation chip. Pressing it opens the help-article passage it came from
(Refund policy › Annual plans, "Cited in the reply to ticket #128"), as an agent opens a source in
the app. Each later section is one short sentence and, where it helps, one true-size fragment of
the real product, so the page reads as a short argument with evidence rather than a feature list.

## Structure

1. **Top bar** (sticky): logo, section links, theme switch, "Try the live demo". On a phone: the
   mark and a menu only.
2. **Hero:** the cited headline ("You approve." in the approval green), one sentence, "Try the
   live demo" and "Create a workspace". The passage card hangs under the chip on wide screens and
   sits after the headline on phones.
3. **How it works:** a slider through four real scenes of ticket #128: a ticket arrives,
   labelled, drafted with sources, approved and sent. Arrow keys work.
4. **Safeguards:** four statements in a plain list: "Every sentence cited.", "No answer, no
   draft.", "Checked first.", "Fast from the keyboard."
5. **"Nothing [Approve & send] itself."** The button in the sentence works: pressing it changes it
   to "Sent by you".
6. **"Tested in public."** The measured results as one sentence (citations 133/133, refusals 30/30,
   prompt injection 20/20 and so on). Each result lights up once in turn (about 5 s), then all stay
   lit. Beside it, a crop of the real evaluation report and a link to the full report.
7. **"Read every line."** For developers: a real request to the public ticket API, the GitHub
   repository and the API reference.
8. **"Bring your team"**: a work-email box that opens sign-up with the address filled in.
9. **Footer** (the one dark band): "See a cited draft now.", the links, the Handoff mark, the
   author, and the product name across the full width, cropped at the bottom only. The name is
   decorative and hidden from screen readers.

"Try the live demo" goes to `/demo`, which signs a visitor into the shared demo workspace in one
tap (agent, admin or owner). The demo password stays on the server (`DEMO_PASSWORD`).

## What the references taught, and what was taken

Live homepages measured on 28 October 2026 at 1440×900 and 390×844 (Playwright, page height in
screens):

| Site     | Desktop / phone screens | Headline | What its first screen does                    |
| -------- | ----------------------- | -------- | --------------------------------------------- |
| Vercel   | 6 / 5.9                 | 64px     | One symbol, one sentence, two stacked buttons |
| Linear   | 11.1 / 7                | 64px     | Headline and real product, fades in once      |
| Intercom | 10.7 / 12.4             | 80px     | Static headline                               |
| Plain    | 13.5 / 19.4             | 80px     | Real product UI                               |
| Resend   | 13.7 / 16.7             | 96px     | 3D object                                     |
| Stripe   | 17.2 / 24.3             | 48px     | Gradient wave                                 |

None of them retypes its headline or plays a fake app. Taken: a short, confident headline at a
large size (Linear, Resend); a phone page as calm as Vercel's (mark and menu, stacked full-width
buttons, almost no boxes); the real product at true size instead of a mock-up (Linear, Plain);
real code as a picture (Resend). This page measures 6.8 screens on a desktop and about 8 on a
phone, close to the median of 8.7 screens in the taste skill's own survey.

Not taken: logo walls, testimonials and customer counts (there are none, so none are shown),
big-number stat strips, gradients, glows, a video, and the template pattern of an eyebrow, a
two-line headline and three feature cards.

## System

- **Type:** Geist only. Headings 560 weight, −0.04em, line height 0.98; the hero 52–124px and
  section headings 38–80px, both fluid. Body 18px; nothing on the page is under 16px except inside
  the product fragments, which use the app's own sizes because they are pictures of it.
  Newsreader, the earlier serif, was removed with its font files.
- **Colour:** the app's tokens (`src/app/theme.css`) in both themes. Green appears in two places
  only, both meaning approval: "You approve." and the sent state.
- **Shape:** the app's 8px radius, hairline borders, no shadows. Product fragments sit on a light
  wash, unframed.
- **Layout:** edge to edge with fluid margins (20–64px), sections 120–240px apart.

## Motion

- On load, once: the two headline lines rise (0.8 s, the second 80 ms later), then the passage
  card opens under the chip (1.1 s, starting at 0.35 s). The headline text never changes.
- Sections come into focus once as they scroll in (a short blur-to-sharp, CSS only).
- The results sentence lights each result in one pass, then stays lit.
- Controls (the slider, the citation chip, Approve & send) respond in 160–200 ms, ease-out.
- Reduced motion skips all of it: everything is visible and still from the start.
- No animation library, no inline styles (the Content Security Policy stays strict): sizes that
  depend on the layout, such as the hanging card and the footer name, are set through the CSSOM
  after the fonts have loaded.

## Honesty rules applied

Every figure comes from the evaluation in `src/lib/landing.ts` (real Gemini models, October 2026)
and links to the report. The grounding score is labelled as AI-graded. Product fragments use the
app's real wording; claims were checked against the code (drafts are written when an agent asks,
the auto-apply threshold is a per-workspace default of 95%, there is no email intake).

## Deviations from the design rules, disclosed

- The display size is above the craft-floor's usual maximum; it is the page's one big moment.
- "You approve." is green, a two-tone headline; it is the approval colour, not decoration.
- The button inside "Nothing Approve & send itself." is an inline control in a heading.
- The results are one sentence, not a table; the full table is one tap away in the report.
- The phone shows the passage card after the headline instead of hanging under the chip.

## Verification

`tests/e2e/landing.spec.ts` (desktop and phone): every call to action, the phone menu, section
links, the citation toggle, the slider by keyboard, Approve & send, the one-pass results
highlight, the email prefill (an invalid address is ignored), scroll focus, reduced motion
(nothing hidden or moving, footer name measured correctly), no sideways scrolling, the footer
name fitting its width, and no CSP errors. axe runs on the settled page in both themes, `/demo`
included. `tests/e2e/visual.spec.ts` keeps screenshot baselines for both themes and the phone.

Lighthouse 13.6 (local production build, 29 October 2026, three runs each): desktop 100 in all
four categories (largest paint 0.3 s, no layout shift); simulated phone performance 97, 100 and
100, the other three categories 100. A first desktop run found a layout shift of 0.142: the hero
was server-rendered with the passage under the headline, and the script then moved it beside the
number. Above 980px CSS now hangs it from the first paint, within 1px of the measured spot.
