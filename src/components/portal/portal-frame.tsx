import { initials } from "@/lib/initials";
import { cn } from "@/lib/utils";

/**
 * The customer-facing frame for the support portal and the private tracking page. It carries the
 * workspace's name rather than SupportPilot's branding (customers are talking to that team), with a
 * small "Powered by" line at the bottom, as hosted help centres usually do.
 */
export function PortalFrame({
  workspaceName,
  children,
  narrow = false,
}: {
  workspaceName: string;
  children: React.ReactNode;
  /** A single reading column (the tracking page) rather than form plus sidebar. */
  narrow?: boolean;
}) {
  const width = narrow ? "max-w-3xl" : "max-w-5xl";
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <header className="bg-background border-b">
        <div className={cn("mx-auto flex h-14 w-full items-center gap-2.5 px-4 sm:px-6", width)}>
          <span
            aria-hidden="true"
            className="bg-brand-subtle text-brand-strong border-brand-border flex size-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold"
          >
            {initials(workspaceName)}
          </span>
          <p className="min-w-0 truncate text-sm font-semibold">
            {workspaceName} <span className="text-muted-foreground font-normal">Support</span>
          </p>
        </div>
      </header>
      <main id="main" className={cn("mx-auto w-full flex-1 px-4 py-10 sm:px-6 sm:py-14", width)}>
        {children}
      </main>
      <footer className="border-t">
        <p className={cn("text-muted-foreground mx-auto w-full px-4 py-5 text-xs sm:px-6", width)}>
          Powered by SupportPilot
        </p>
      </footer>
    </div>
  );
}
