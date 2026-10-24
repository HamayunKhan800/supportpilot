# App shell

The frame around every workspace page (design system step 2, `docs/plans/design-system.md`).

## Parts

| Part                | File                                                                  | Notes                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layout              | `src/app/app/(workspace)/layout.tsx`                                  | Builds the link list from the user's role, reads the theme and sidebar cookies, counts open tickets. Pages still check permissions on their own. |
| State and shortcuts | `shell/shell-context.tsx`                                             | Theme, collapsed sidebar, palette and shortcut-sheet state; one global `keydown` listener.                                                       |
| Sidebar             | `shell/sidebar.tsx`                                                   | Wide screens: sticky, collapses to icons. Narrow screens: a top bar with a menu button that opens the same content in a drawer (Base UI Dialog). |
| User menu           | `shell/user-menu.tsx`                                                 | Base UI Menu: account, theme (radio items), keyboard shortcuts, sign out.                                                                        |
| Command palette     | `shell/command-palette.tsx`                                           | Base UI Dialog with the WAI-ARIA combobox and listbox pattern.                                                                                   |
| Shortcut sheet      | `shell/shortcut-sheet.tsx`                                            | Lists only shortcuts that exist, in groups (`SHORTCUT_GROUPS`).                                                                                  |
| Missing pages       | `(workspace)/not-found.tsx`                                           | `notFound()` inside the workspace keeps the shell, instead of the bare global 404.                                                               |
| Pure logic          | `src/lib/navigation.ts`, `src/lib/shortcuts.ts`, `src/lib/sidebar.ts` | Active link, grouping, palette matching, ticket numbers, shortcut rules, cookie format. Unit-tested in `tests/unit/navigation.test.ts`.          |

## Navigation

- **Groups:** Overview; **Work** (Tickets with an open-ticket count, Knowledge); **Insights** (Analytics, Evaluation); **Admin** (Members, AI settings, Audit log, Review). Account is in the user menu and the palette.
- **Current page:** the longest matching link wins, so `/app/analytics/evaluation` marks Evaluation, not Analytics. `aria-current="page"` on the page itself, `"true"` on its sub-pages (e.g. a ticket under Tickets).
- The open count is announced as a description ("10 open"), so the link's name stays "Tickets".

## Keyboard

| Keys            | Action                         | Where                                         |
| --------------- | ------------------------------ | --------------------------------------------- |
| Ctrl K / ⌘ K    | Command palette                | Everywhere, including text fields             |
| ?               | Shortcut sheet                 | Not while typing, not inside menus or dialogs |
| [               | Collapse or expand the sidebar | Wide screens; same rules as ?                 |
| ↑ ↓, Enter, Esc | Move, open, close              | Inside the palette                            |

Single-key shortcuts stay off while typing (WCAG 2.1.4), and every shortcut has a visible control.

## Command palette

- **Results:** pages for the user's role, then Account, theme, help and sign out.
- **Ticket number:** typing `#12`, `12` or `ticket 12` puts "Open ticket #12" first.
- **Fallback:** any other text ends the list with "Search tickets for …", which opens the inbox search. There is never a dead end.
- **Matching:** case- and accent-insensitive, and every word must match. Labels that start with the query rank first.
- **No server calls:** the palette only knows the links the server already rendered.

## Accessibility decisions

- **Palette scrolling:** the whole palette scrolls, with the search box pinned on top. A scroll area must contain something keyboard-focusable (axe `scrollable-region-focusable`), and the options are not focusable themselves (focus stays in the box; `aria-activedescendant` moves the highlight).
- **Sticky top bar on narrow screens:** `scroll-padding-top` keeps focused content below it (WCAG 2.4.11).
- **Target sizes:** sidebar links and menu items are 32 px tall; mobile header buttons are 40 px (WCAG 2.5.8 asks for 24 px).
- **Collapsed sidebar:** link names stay in the accessibility tree (visually hidden), with a hover and focus label for sighted users.
- **Menu links:** `Menu.LinkItem` needs `closeOnClick`. Next.js navigates without a page load, so otherwise the menu stays open over the new page (found by the E2E test).

## Security

- **CSP:** no new inline scripts or style attributes in server HTML. Base UI positions menus through the CSS object model at runtime, which the policy allows. The E2E CSP fixture fails any test on a violation.
- **Cookies:** `sp_sidebar` is display-only like `sp_theme`. Only the exact value `collapsed` has an effect.

## Tests

- **Unit:** `tests/unit/navigation.test.ts`.
- **Browser:** `tests/e2e/shell.spec.ts`:
  - desktop: groups, current page, collapse remembered after reload, `[`; palette by keyboard (pages, ticket number, ticket search, theme); `?` not firing in a text field; account menu;
  - mobile: drawer, 40 px targets, closes after navigating;
  - axe audits with each overlay open.
- **Shared helpers** in `tests/e2e/fixtures.ts`: `workspaceNav()` opens the drawer first on mobile, so specs run unchanged on both projects.
