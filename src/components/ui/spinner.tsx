import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small spinning ring for work that is really in progress (a request, a page loading).
 * Decorative: the surrounding text says what is happening ("Saving…"). With reduced motion it
 * stands still.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      aria-hidden="true"
      data-spinner=""
      className={cn("size-4 shrink-0 animate-spin motion-reduce:animate-none", className)}
    />
  );
}
