/**
 * Wraps a table that may scroll sideways on small screens. The scroll area is a labelled,
 * focusable region so keyboard users can reach and scroll it (WCAG 2.1.1; axe
 * scrollable-region-focusable, finding #92).
 */
export function TableScroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="focus-visible:ring-ring overflow-x-auto rounded-lg border outline-none focus-visible:ring-2"
    >
      {children}
    </div>
  );
}
