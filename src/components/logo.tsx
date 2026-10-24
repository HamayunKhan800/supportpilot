import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Product mark, drawn for SupportPilot: a reply bubble with a check in it, for "a reply a person
 * approved". Plain SVG geometry (no image file, no inline style) so it renders under the CSP.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-primary text-primary-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md",
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="size-4" focusable="false">
        <path
          fill="currentColor"
          d="M3 2.5h10A1.5 1.5 0 0 1 14.5 4v6a1.5 1.5 0 0 1-1.5 1.5H7.6L4.6 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5Z"
        />
        <path
          d="m5.4 7.1 1.8 1.8 3.5-3.6"
          fill="none"
          className="stroke-primary"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** Mark and name, linking home: the header of every public page. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "focus-visible:ring-ring inline-flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-2",
        className,
      )}
    >
      <LogoMark />
      SupportPilot
    </Link>
  );
}
