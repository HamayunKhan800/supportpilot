# Design step 9: live landing, focus states, sign-in and app polish

Status: proposed (24 Oct 2026). Follows `design-system.md` and `feedback-and-motion.md`.

The owner's feedback after testing the live demo:

1. The landing page is good but should feel live: the hero and other sections interactive, not
   pictures of the product.
2. Do the app pages match the reference products (Linear, Plain, Intercom, Vercel Geist)?
3. Outlines look wrong when clicking form fields.
4. Sign-in and sign-up could be more interactive; is the font right?

## What the checks found

### Outlines (measured with Playwright on a Pixel 7 profile and a 1440 px desktop)

| Element                         | Today                                                                | Problem                                       |
| ------------------------------- | -------------------------------------------------------------------- | --------------------------------------------- |
| Text fields and text areas      | Blue border plus a 3 px pale-blue glow on every tap or click         | The stock shadcn look; blue is off the Ink brand, heavy on a phone |
| Native selects (Status, Priority, filters) | The browser's own `outline: auto` in a 50 % blue           | A doubled outline that matches nothing else   |
| Buttons and links               | A third style (`ring-3 ring/50`)                                     | Three focus styles in one product             |

Linear and Vercel: a field that is clicked only darkens its border (with a faint neutral halo);
the strong ring is for keyboard focus. WCAG 2.2 (2.4.7, 2.4.11, 2.4.13) asks for a visible
indicator with enough contrast, which a darker 1 px border plus a 1 px inner ring meets for
fields; keyboard focus keeps a 2 px ring with a 2 px offset.

### App pages compared with the references

Good already: a calm, neutral palette; a sidebar and list density close to Linear; skeletons,
toasts and live updates; keyboard shortcuts and a command palette.

Where they still look like a generic admin form rather than Linear, Plain or Intercom:

| Page      | Today                                                       | In the references                                                     |
| --------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| Ticket    | Status, Priority, Category, Assignee are native selects     | Property rows: icon + value buttons that open a small menu (Linear, Plain) |
| Inbox     | A row of selects plus an "Apply filters" button             | Filters apply instantly; chips show what is active and clear with one click |
| All pages | A large title and a sentence of description at the top      | A compact top bar (title, count, breadcrumb, actions); help text lower down |
| Knowledge | The browser's "Choose File / No file chosen" control        | A drop zone: drag a file or pick one, with progress                    |
| Settings  | One long form with a Save button at the very bottom         | Grouped sections; a bar appears when there are unsaved changes        |

### Sign-in and sign-up

On a phone the form floats in the middle with a large empty area above it; on desktop the right
half shows a static preview. Missing: show/hide password, caps-lock hint, a password-length meter
on sign-up (NIST SP 800-63B: length, not composition rules), a pending state on the button,
inline errors on leaving a field.

### Fonts (read from each live site's computed styles, 24 Oct 2026)

| Product  | Headings                  | Text              | Code / mono       |
| -------- | ------------------------- | ----------------- | ----------------- |
| Linear   | Inter Variable            | Inter Variable    | Berkeley Mono     |
| Vercel   | Geist                     | Geist             | Geist Mono        |
| Plain    | ABC Favorit (paid)        | ABC Favorit       | Geist Mono        |
| Intercom | Saans (paid)              | Saans             | Saans Mono        |
| Pylon    | Die Grotesk (paid)        | Die Grotesk       | Geist Mono        |
| Resend   | Domaine (paid serif)      | Inter             | Commit Mono       |
| Stripe   | Söhne (paid)              | Söhne             |                   |
| Notion   | Inter (custom cut)        | Inter             |                   |
| GitHub   | Mona Sans (free, OFL)     | Mona Sans         | Mona Sans Mono    |
| Supabase | Manrope                   | Inter             | Source Code Pro   |

Geist is a sound choice: it is what Vercel uses, and Plain and Pylon use Geist Mono. The more
"premium" brands use paid typefaces, which our rules exclude. The free alternatives in this
class are Inter (Linear, Notion) and Mona Sans (GitHub).

## Steps

Each step is committed and tested on its own; nothing is pushed until the owner says so.

1. **Focus and field states.** One system: fields darken their border on focus (ink, no blue
   glow); keyboard focus on everything gets a 2 px ring with a 2 px offset; native selects get
   the same treatment; errors keep the red border. Check both themes with axe and a contrast
   check of the focus indicators.
2. **A live hero.** The hero becomes a small working app that runs in the browser on sample
   data, clearly labelled as a demo (no AI call, nothing sent). It plays by itself (a new ticket
   arrives, triage fills in, a draft streams in with its citations, checks pass, an agent
   approves, a toast says "Reply sent") and the visitor can take over at any time: pick a
   ticket, press Generate draft, open a source, press Approve & send. It pauses when off screen
   or hidden, stops with reduced motion, and works by keyboard.
3. **Other sections live.** Workflow tabs advance on their own with a visible progress line and
   pause on hover or focus; the guardrail cards can be toggled (a draft that cites a source that
   doesn't exist, before and after the check); the command palette scene accepts typing; the
   portal scene sends a sample request into the inbox mock. The API sample gets curl and
   TypeScript tabs.
4. **Sign-in and sign-up.** A compact phone layout; on desktop the right half plays the live
   demo from step 2. Show/hide password, caps-lock hint, a length meter, a pending button and
   errors shown when leaving a field. Strings used by the E2E tests stay.
5. **App pages.** Property menus on the ticket (keyboard-operable menus, not Base UI Select);
   instant inbox filters with chips; a compact top bar; a knowledge drop zone; an unsaved-changes
   bar in settings. No backend changes.
6. **Type and finish.** Keep Geist unless the owner picks another free face; tune heading sizes
   and spacing, tabular numbers in tables. Then fresh screenshots, README, full test suites,
   Lighthouse, secret scan.

## Rules carried over

No new dependencies or animation library; CSP stays strict (no inline styles); motion under
300 ms with ease-out, nothing animated on keyboard or frequent actions; reduced motion respected;
no fake logos, numbers or confidence; role-based E2E selectors; zero axe violations in both
themes; targets ≥ 24 px; desktop Lighthouse 100 and mobile performance not below today's 83.

## Risks

- Interactive islands add JavaScript, and the landing page's mobile score is already held back by
  hydration. The demo will be one small client component with plain timers; it is measured after
  step 2, and trimmed if mobile performance drops below 83.
- Replacing native selects changes many E2E steps (the tests use `selectOption`); they will be
  rewritten to role-based menu steps in the same commit.
