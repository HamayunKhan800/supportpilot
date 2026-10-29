---
name: SupportPilot
description: AI-drafted support replies that cite their sources, approved by a person.
colors:
  ink: "oklch(0.22 0.006 286)"
  ink-hover: "oklch(0.32 0.006 286)"
  paper: "oklch(0.993 0.002 286)"
  sheet: "oklch(1 0 0)"
  text: "oklch(0.22 0.016 286)"
  text-quiet: "oklch(0.47 0.014 286)"
  wash: "oklch(0.962 0.005 286)"
  wash-strong: "oklch(0.942 0.006 286)"
  hairline: "oklch(0.892 0.008 286)"
  field-stroke: "oklch(0.6 0.011 286)"
  focus-blue: "oklch(0.55 0.17 255)"
  band: "oklch(0.175 0.006 286)"
  success: "oklch(0.5 0.131 152)"
  warning: "oklch(0.8 0.15 72)"
  danger: "oklch(0.53 0.2 27)"
  info: "oklch(0.53 0.133 245)"
  dark-paper: "oklch(0.165 0.005 286)"
  dark-sheet: "oklch(0.195 0.006 286)"
  dark-text: "oklch(0.95 0.006 286)"
  dark-text-quiet: "oklch(0.8 0.012 286)"
  dark-hairline: "oklch(0.338 0.011 286)"
  dark-focus-blue: "oklch(0.72 0.148 255)"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(52px, 7.6vw, 124px)"
    fontWeight: 560
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(38px, 4.8vw, 80px)"
    fontWeight: 560
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  bar-title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  page-title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.333
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  small:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.385
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.333
  data:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  sm: "4.8px"
  md: "6.4px"
  lg: "8px"
  xl: "11.2px"
  full: "9999px"
spacing:
  unit: "4px"
  row: "32px"
  card: "16px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    height: "32px"
  card:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
    padding: "{spacing.card}"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    height: "32px"
---

# Design System: SupportPilot

Source of truth for values: `src/app/theme.css` (colour roles, both themes) and
`src/app/globals.css` (Tailwind theme, fonts, motion). Decisions and their reasons:
`docs/plans/design-system.md`. Product truth: `PRODUCT.md`. Written by Impeccable `document`
(scan mode) on 2026-10-28; the North Star was chosen by the owner the same day.

## Overview

**Creative North Star: "The Cited Draft"**

SupportPilot looks like a well-sourced document that people work in all day. Ink on paper-white
(or paper-light on ink in dark mode), hairline rules instead of boxes, and a quiet hierarchy where
the content (a customer's words, a draft, its sources) is the loudest thing on screen. Like a good
draft with footnotes, nothing is asserted without a source: AI output is labelled, citations are
numbered and open the passage they came from, and every number on a page links to the report it
came from.

The app is dense and calm (14px body, 32px rows, keyboard-first); colour appears only when it
means something. The landing page is the one place with a voice: very large, tightly set Geist
headlines on plain paper, the product shown as true-size fragments, still ink-only (2026-10-29). Rejected on purpose (owner decisions 2026-10-24): indigo/purple as a brand
colour, a chat-bubble logo, eyebrow pills above headlines, two-tone headlines, numbered 01–04 step
cards, big-number stat strips, ALL-CAPS section labels and icons in tinted tiles.

**Key Characteristics:**

- Ink only: near-black / near-white with neutral greys at hue 286 (a whisper of cool).
- Colour is semantic: green, amber, red and blue for status; a blue focus ring.
- Flat by default; only floating layers (menus, dialogs, popovers, palette) cast shadows.
- Sources are visible: numbered citations, passages on demand, links to evidence.
- Both themes are first-class and follow the device; contrast is unit-tested in CI.

## Colors

One ink, neutral paper, and four status hues that are never decorative.

### Primary

- **Ink** (oklch(0.22 0.006 286)): primary buttons, the logo, active navigation, selected tabs.
  Hover lifts to **Ink Hover** (oklch(0.32 0.006 286)). In dark mode ink inverts to
  oklch(0.95 0.006 286).

### Neutral

- **Paper** (oklch(0.993 0.002 286)): page background (dark: oklch(0.165 0.005 286)).
- **Sheet** (oklch(1 0 0)): cards and inputs (dark: oklch(0.195 0.006 286)).
- **Text** (oklch(0.22 0.016 286)) and **Quiet Text** (oklch(0.47 0.014 286)): body and
  secondary copy; both pass 4.5:1 on paper and sheet in both themes.
- **Wash** (oklch(0.962 0.005 286)) / **Strong Wash** (oklch(0.942 0.006 286)): table heads,
  hover rows, muted chips.
- **Hairline** (oklch(0.892 0.008 286)): borders and dividers; **Field Stroke**
  (oklch(0.6 0.011 286)) for input outlines (3:1).
- **Band** (oklch(0.175 0.006 286); 0.12 in dark mode): the landing page's footer, its only dark
  section.

### Status (meaning only)

- **Success** green (152), **Warning** amber (72), **Danger** red (27), **Info** blue (245), each
  with subtle / border / strong steps for chips and callouts. "Open" tickets use info blue.
- **Focus Blue** (oklch(0.55 0.17 255); dark oklch(0.72 0.148 255)): the focus ring, chosen to
  stay visible next to ink buttons.

### Named Rules

**The Ink Only Rule.** The brand has one colour, ink. A new accent hue needs an owner decision.
**The Meaning Rule.** Green, amber, red and blue appear only to say something about state.

## Typography

**Heading and Body Font:** Geist 400/500/600 (self-hosted from the `geist` package).
**Data Font:** Geist Mono 400/500 for identifiers, keys, code and measurements only.

**Character:** one precise grotesque everywhere. The landing page gets its voice from size and
tight spacing, not from a second typeface (Newsreader was removed on 2026-10-29).

### Hierarchy

- **Display** (Geist 560, 52–124px fluid, 0.98, -0.04em): the landing hero only. Its citation chip
  is Geist 600 at 0.36em.
- **Headline** (Geist 560, 38–80px fluid, 0.98, -0.04em): landing sections. Never more than two
  lines on a 390px phone.
- **Bar title** (Geist 600, 16/24): the h1 of list, settings and admin pages, set in the top bar
  beside the breadcrumb (`PageHeader`). Compact on purpose: those pages are frames for their
  tables and forms, which carry the weight.
- **Page title** (Geist 600, 24/32; 20/28 on phones for tickets): the h1 of a page about one
  item, the ticket subject or the knowledge article title.
- **Title** (Geist 600, 20/28) and card titles (Geist 500, 14/20).
- **Body** (Geist 400, 14/20 in the app; 18/27 on the landing, never under 16px there). Descriptions, ticket
  messages and knowledge passages are capped at 52ch (`max-w-measure`, about 70 Geist
  characters).
- **Small** (13/18) and **Label** (12/16, 500). Nothing smaller than 12px in the app. The landing
  page's product fragments use the app's own sizes (12–15px) because they are pictures of it.

### Named Rules

**The One Family Rule.** Geist everywhere, landing included; hierarchy comes from size and weight.
**The Real Data Rule.** Monospace marks real identifiers and numbers, never "technical" flavour.

## Layout

A 4px grid. The app has a 240px sidebar (56px collapsed) and content up to 1280px (wider pages
up to 1600px); the ticket page is a split view: queue, conversation and details, with the queue
appearing when the page area reaches 70rem. Rows are 32px; tables scroll horizontally inside
their card on small screens. The landing page runs edge to edge with fluid margins
(20–64px) and sections 120–240px apart, product fragments set against a light wash. Phones get one column, 44px tap areas on primary controls and never
less than 24px for any target.

## Elevation & Depth

Flat by default, raised only when floating (Linear's rule). Cards and panels separate with a
hairline ring and a change of surface (paper → sheet), not shadows. Shadows appear on layers that
float above the page: menus, popovers, dialogs and the command palette.

### Named Rules

**The Flat-By-Default Rule.** A resting surface never casts a shadow.

## Shapes

Base radius 8px: 6px controls, 8px buttons and inputs, 12px cards and floating layers, full
rounding only for avatars, status dots and pills. Borders are 1px hairlines; a 2px line is used
only as a selection indicator (active tab, chart cursor). The logo is a circle (the AI's draft)
overlapping a square (the person who approves it), the overlap cut out.

## Components

### Buttons

- **Shape:** 8px radius, 32px tall (36px large, 28px small).
- **Primary:** ink background, white text; hover to ink-hover. One primary per view.
- **Outline / Ghost / Secondary:** hairline or wash; hover to wash.
- **Destructive:** red text on a 10% red tint, 15% on hover (contrast-tested).
- **Focus:** the blue ring, always visible, never obscured.

### Cards / Containers

- **Corner Style:** 12px. **Background:** sheet on paper. **Border:** 1px ring at 10% ink.
  **Padding:** 16px. No nested cards; no shadows at rest.

### Inputs / Fields

- **Style:** sheet background, field-stroke outline, 8px radius, 32px tall.
- **Focus:** blue ring. **Error:** red border with a message that names the fix.

### Navigation

- Sidebar with plain icons (no tiles), quiet labels, ink for the active item, a count where it
  helps. The command palette (Ctrl/⌘ K) opens instantly with no animation.

### Citations (signature component)

- Numbered source chips inside an AI draft; each opens the exact passage it came from, with the
  article title and heading path. This is the product's core promise made visible, and the
  pattern other surfaces borrow when they need to show evidence.

## Do's and Don'ts

### Do:

- **Do** link every number to the report or document that proves it.
- **Do** label AI output as AI, and show what it was based on.
- **Do** keep motion under 300ms, ease-out, for menus and panels only; nothing on keyboard or
  high-frequency actions; respect reduced motion. Landing exceptions: on load the headline rises and
  the passage card opens once (done by 1.5 s); sections come into focus once as
  they scroll in, and the results sentence lights each result in one pass (about 5 s), then stays
  lit. Reduced motion skips both.
- **Do** test both themes: zero axe violations, 4.5:1 text, 3:1 borders and focus.
- **Do** use lucide icons (one stroke weight) for every icon.

### Don't:

- **Don't** add a brand accent colour, purple or indigo, or decorative gradients in the app.
- **Don't** put an eyebrow or kicker above a heading, or use ALL-CAPS section labels.
- **Don't** build big-number stat strips, numbered 01–04 cards or icon-in-tile features.
- **Don't** invent logos, testimonials, customers, counts or confidence percentages.
- **Don't** use text glyphs (↗ ✓ →) as icons, or monospace as decoration.
- **Don't** add heavy dependencies, inline styles (strict CSP) or third-party fonts.

### The cited sentence (landing page, 2026-10-29)

The page makes one argument: the headline is itself a cited sentence. "AI drafts.[1] You
approve." carries a real citation chip; pressing it opens the help-article passage it came from,
exactly as an agent opens a source in the app. Every later section repeats the pattern in prose:
a short sentence, one true-size fragment of the real product, nothing in frames. Green, the
approval colour, appears in two places only: "You approve." and the sent state. The footer is the
one dark band and ends with the product name set across the full width, cropped at the bottom
(decorative, hidden from screen readers). No logos, testimonials, stat strips or video. The full
rationale, references and measurements are in `docs/design/landing.md`. Browser surfaces
(selection, caret, scrollbars, checkbox and radio accent) take the ink palette.
