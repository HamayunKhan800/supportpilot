# Design tokens

How SupportPilot's colours, type and themes work (design system step 1, `docs/plans/design-system.md`).

## Where things live

| File                                                | Role                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/design/tokens.ts`                          | **Source of truth.** Generates every colour from a few inputs: brand hue and chroma (ink: hue 286°, chroma 0.006; Iris until 2026-10-24), status hues, per-step lightness and chroma curves.                                              |
| `src/lib/design/color.ts`                           | OKLCH → sRGB conversion, gamut fitting, WCAG contrast.                                                                                                                                                                                    |
| `src/app/theme.css`                                 | **Generated** by `pnpm design:tokens`. Never edit by hand.                                                                                                                                                                                |
| `src/app/globals.css`                               | Maps tokens to Tailwind utilities (`bg-warning-subtle`, …), fonts, radius and the `dark:` variant.                                                                                                                                        |
| `src/lib/theme.ts`, `src/lib/preferences-client.ts` | Theme preference cookie and applying it in the browser. The switch lives in the user menu and the command palette (`docs/design/app-shell.md`); `src/components/theme-toggle.tsx` is a standalone switch for pages without the app shell. |
| `tests/unit/design-tokens.test.ts`                  | Contrast, gamut, scale order, stylesheet drift, and a ban on raw palette classes.                                                                                                                                                         |

## Colour model

- **12-step scales** (Radix Colors roles): 1–2 backgrounds, 3–5 component states, 6–8 borders and focus, 9–10 solid fills, 11–12 text.
- **OKLCH**, so equal lightness looks equally light; changing `BRAND.hue` re-themes everything.
- **Gamut fitting:** chroma is reduced until the colour fits sRGB, so the screen shows exactly the colour the tests measured.
- **Neutrals** carry a trace of cool hue (chroma ≤ 0.016).
- **Focus rings** are a functional blue (`FOCUS`, hue 255°), so focus stays visible next to ink buttons.
- **Dark mode primary** is near-white with ink text; light mode primary is ink with white text.

## Which token to use

| Need                                           | Use                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Page, card, popover                            | `bg-background`, `bg-card`, `bg-popover`                                           |
| Body text, secondary text                      | `text-foreground`, `text-muted-foreground`                                         |
| Main action                                    | `bg-primary text-primary-foreground hover:bg-primary-hover` (the Button does this) |
| Hover or selected row                          | `bg-accent` / `bg-muted`                                                           |
| Borders, field borders, focus                  | `border-border`, `border-input`, `ring-ring`                                       |
| Brand tint (selected nav, AI draft, citations) | `bg-brand-subtle border-brand-border text-brand-strong`                            |
| Status box                                     | `bg-{success,warning,danger,info}-subtle border-…-border text-…-strong`            |
| Status dot or icon                             | `text-…-strong` (amber solids cannot reach 3:1 on white)                           |
| Solid status badge                             | `bg-{status} text-{status}-foreground`                                             |
| Charts                                         | `chart-1` … `chart-5` (each ≥ 3:1 against the page)                                |

Raw Tailwind palette classes (`bg-amber-50`, `text-red-800`, `text-white`, …) fail the unit tests: they are not contrast-tested and do not switch with the theme.

## Contrast targets (tested in both themes)

- Text: **4.5:1** (WCAG 1.4.3), including text on translucent tints such as the destructive button at 10% and 15%.
- Field borders, focus rings, status icons, chart marks: **3:1** (WCAG 1.4.11).

## Themes

- **System (default):** no cookie; CSS follows `prefers-color-scheme`.
- **Light / Dark:** the `sp_theme` cookie. The server renders `<html data-theme>` on the first byte, so there is **no pre-paint script, no flash, and no CSP exception**. Unknown cookie values are ignored.

## Type, spacing, radius

- **Geist Sans** (UI) and **Geist Mono** (IDs, timings, costs), SIL Open Font License, self-hosted through the `geist` package and `next/font/local`. No request to Google; `font-src 'self'` holds.
- 4 px spacing grid (Tailwind's default scale).
- Radius: `--radius: 0.5rem`. Buttons and fields use `rounded-lg` (8 px), cards `rounded-xl` (about 11 px); the other steps scale from `--radius`.

## Changing the brand colour

1. Edit `BRAND` in `src/lib/design/tokens.ts`.
2. Run `pnpm design:tokens`.
3. Run `pnpm test`. If a contrast pair fails, adjust the solid lightness (`BRAND_SOLID`) until it passes.
