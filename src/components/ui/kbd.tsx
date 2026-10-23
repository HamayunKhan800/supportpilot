import { cn } from "cn";
import type * as React from "react";

/** A key cap, e.g. <Kbd>K</Kbd>. Decorative by default: pair it with words for screen readers. */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "border-border bg-muted text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-sans text-[11px] leading-none font-medium",
        className,
      )}
      {...props}
    />
  );
}
