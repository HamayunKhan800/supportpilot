import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Small building blocks for the landing page's product pictures. They reuse the app's tokens and
 * wording (labels match the real screens), and they are pictures, not controls: nothing here is
 * focusable, and every composition that uses them is aria-hidden with a visible caption.
 */

/** An app window: a thin title bar with three neutral dots, then the content. */
export function Window({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-card text-card-foreground overflow-hidden rounded-xl border", className)}>
      <div className="bg-muted/50 flex h-9 items-center gap-3 border-b px-3.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="bg-border size-2.5 rounded-full" />
          <span className="bg-border size-2.5 rounded-full" />
          <span className="bg-border size-2.5 rounded-full" />
        </span>
        {title && <span className="text-muted-foreground truncate font-mono text-[11px]">{title}</span>}
      </div>
      {children}
    </div>
  );
}

/** A citation marker as the draft shows it. */
export function Cite({ n, className }: { n: number; className?: string }) {
  return (
    <span
      className={cn(
        "bg-brand-subtle text-brand-strong inline-flex h-4 min-w-4 items-center justify-center rounded px-1 align-[1px] font-mono text-[11px] font-medium",
        className,
      )}
    >
      {n}
    </span>
  );
}

/** A button-shaped label (not a button: the pictures hold nothing to click). */
export function FakeButton({
  children,
  primary = false,
  className,
}: {
  children: ReactNode;
  primary?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium whitespace-nowrap",
        primary ? "bg-primary text-primary-foreground border-transparent" : "bg-background",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small rounded label, as used for categories and checks. */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "text-muted-foreground inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Initials in a circle, the way the app shows people. */
export function Initials({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** The priority glyph from the inbox: three bars, filled up to the level. */
export function PriorityBars({ level }: { level: 1 | 2 | 3 | 4 }) {
  if (level === 4) {
    return (
      <span className="bg-danger text-danger-foreground inline-flex size-3.5 items-center justify-center rounded-[3px] text-[9px] leading-none font-bold">
        !
      </span>
    );
  }
  return (
    <span className="inline-flex h-3 items-end gap-[2px]">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-[1px]",
            i === 1 ? "h-1" : i === 2 ? "h-2" : "h-3",
            i <= level ? "bg-foreground/70" : "bg-border",
          )}
        />
      ))}
    </span>
  );
}

/** The status glyph: an open ring, a half-filled ring for pending, a filled one for resolved. */
export function StatusRing({ status }: { status: "open" | "pending" | "resolved" }) {
  return (
    <span
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px]",
        status === "open" && "border-info",
        status === "pending" && "border-warning",
        status === "resolved" && "border-success bg-success",
      )}
    >
      {status === "pending" && <span className="bg-warning size-1.5 rounded-full" />}
    </span>
  );
}

/** A row of keys, as on the keyboard shortcut sheet. */
export function Keys({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn("inline-flex gap-1", className)}>
      {keys.map((k) => (
        <span
          key={k}
          className="bg-background text-foreground inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-2 px-1.5 font-mono text-[11px] font-medium"
        >
          {k}
        </span>
      ))}
    </span>
  );
}
