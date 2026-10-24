import Link from "next/link";
import { cn } from "@/lib/utils";

/** The mark's geometry on a 24-unit grid; shared with the favicon, app icon and share image. */
export const LOGO_PATH = "M9 5.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13Z M11 7h10v10H11Z";

/**
 * Product mark, "Handoff": a circle (the AI's draft) passing over a square (the person who
 * approves it); where they overlap is cut out, the moment of review. One even-odd path in the
 * current text colour, so it is ink in light mode and white in dark mode, and stays legible at
 * 16 px. Plain SVG attributes (no image file, no inline style) so it renders under the CSP.
 * Chosen 2026-10-24 to replace a chat-bubble-with-tick that matched a stock icon
 * (docs/plans/design-system.md, step 7).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-7 shrink-0 items-center justify-center", className)}
    >
      <svg viewBox="0 0 24 24" className="size-6" focusable="false">
        <path fill="currentColor" fillRule="evenodd" d={LOGO_PATH} />
      </svg>
    </span>
  );
}

/** Mark and name, linking home: the header of every public page. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("inline-flex items-center gap-2 rounded-md font-semibold tracking-tight", className)}
    >
      <LogoMark className="-mx-0.5" />
      SupportPilot
    </Link>
  );
}
