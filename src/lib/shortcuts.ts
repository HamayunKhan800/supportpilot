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

/** What the shortcut sheet lists: only shortcuts that exist. */
export const SHELL_SHORTCUTS: ShortcutHelp[] = [
  { keys: ["Mod", "K"], label: "Search or jump to a page, a ticket or a setting" },
  { keys: ["?"], label: "Show keyboard shortcuts" },
  { keys: ["["], label: "Collapse or expand the sidebar (wide screens)" },
  { keys: ["Esc"], label: "Close a menu or dialog" },
];
