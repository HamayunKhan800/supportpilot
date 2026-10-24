import { cn } from "cn";

/**
 * Wraps a table that may scroll sideways on small screens. The scroll area is a labelled,
 * focusable region so keyboard users can reach and scroll it (WCAG 2.1.1; axe
 * scrollable-region-focusable, finding #92).
 */
export function TableScroll({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  /** e.g. "rounded-none border-0" when the table sits flush inside a Section. */
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "focus-visible:ring-ring overflow-x-auto rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-inset",
        className,
      )}
    >
      {children}
    </div>
  );
}
