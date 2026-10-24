/**
 * Global keyboard shortcuts of the app shell. Every shortcut also has a visible control
 * (WCAG 2.1.4: single-key shortcuts are off while typing and inside menus and dialogs).
 */

export type ShellAction = "palette" | "shortcuts" | "sidebar";

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  /** Focus is in a text field, select or contenteditable element. */
  typing: boolean;
  /** Focus is inside an open menu or dialog. */
  inOverlay: boolean;
}

/** The action a key press triggers, or null. */
export function shellActionFor(e: KeyInput): ShellAction | null {
  // Ctrl/Cmd + K works everywhere, including text fields: that is the convention users know.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") return "palette";
  if (e.ctrlKey || e.metaKey || e.altKey || e.typing || e.inOverlay) return null;
  if (e.key === "?") return "shortcuts";
  if (e.key === "[") return "sidebar";
  return null;
}

/**
 * The page shortcut a key press triggers (lower-case letter from `keys`), or null.
 * Page shortcuts are plain letters: never with a modifier, while typing, or inside an overlay.
 */
export function pageKeyFor(e: KeyInput, keys: readonly string[]): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.typing || e.inOverlay) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return keys.includes(key) ? key : null;
}

/** True when keys typed at `el` are text input, so single-key shortcuts must not fire. */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes(el.type);
  }
  return false;
}

export interface ShortcutHelp {
  /** "Mod" renders as ⌘ on Apple devices and Ctrl elsewhere. */
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutHelp[];
}

/** What the shortcut sheet lists: only shortcuts that exist, grouped by where they work. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Everywhere",
    shortcuts: [
      { keys: ["Mod", "K"], label: "Search or jump to a page, a ticket or a setting" },
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["["], label: "Collapse or expand the sidebar (wide screens)" },
      { keys: ["Esc"], label: "Close a menu or dialog" },
    ],
  },
  {
    title: "Ticket list",
    shortcuts: [
      { keys: ["J"], label: "Next ticket" },
      { keys: ["K"], label: "Previous ticket" },
      { keys: ["Enter"], label: "Open the selected ticket" },
    ],
  },
  {
    title: "On a ticket",
    shortcuts: [
      { keys: ["J"], label: "Next ticket in the list you came from" },
      { keys: ["K"], label: "Previous ticket in the list you came from" },
      { keys: ["E"], label: "Edit the AI draft" },
      { keys: ["A"], label: "Go to Approve & send (then press Enter to send)" },
      { keys: ["R"], label: "Go to Regenerate (then press Enter)" },
    ],
  },
];
