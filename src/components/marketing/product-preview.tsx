import { cn } from "cn";
import { CircleCheck, Pencil, PenLine, RefreshCw, Send, X } from "lucide-react";

/**
 * A static picture of the ticket screen, built from the app's own tokens and wording (the
 * labels match the real draft panel and its automatic checks), with demo content from the
 * Nimbus help centre. It is decorative: the caption that goes with it says what it shows,
 * so the whole preview is hidden from assistive technology and holds nothing focusable.
 */
export function ProductPreview({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "bg-card text-card-foreground overflow-hidden rounded-xl border text-left shadow-xl select-none",
        className,
      )}
    >
      {!compact && (
        <div className="bg-muted/40 text-muted-foreground flex items-center gap-1.5 border-b px-4 py-2.5 text-xs">
          <span>Nimbus Cloud Storage</span>
          <span>/</span>
          <span>Tickets</span>
          <span>/</span>
          <span className="text-foreground font-medium">#128</span>
        </div>
      )}
      <div className={cn("grid grid-cols-1", !compact && "md:grid-cols-[minmax(0,1fr)_14rem]")}>
        <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
          {!compact && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground font-mono text-xs">#128</span>
                <span className="text-base font-semibold tracking-tight">Refund for my annual plan</span>
              </div>
              <div className="bg-muted/50 rounded-lg border p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">Priya Shah</span>
                  <span className="text-muted-foreground">12 min ago</span>
                </div>
                My annual plan renewed 12 days ago and I didn&apos;t mean to keep it. Can I get my money back,
                and how long does it take?
              </div>
            </div>
          )}

          <div className="rounded-lg border">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className="bg-brand-subtle text-brand-strong inline-flex size-5 items-center justify-center rounded">
                  <PenLine className="size-3" />
                </span>
                AI draft
              </span>
              <span className="text-muted-foreground font-mono text-[11px]">gemini-3.8-flash</span>
            </div>
            <div className="flex flex-col gap-3 p-3">
              <ul className="flex flex-wrap gap-1.5">
                {["Cites 2 sources", "Every citation matches a source", "No unfamiliar links"].map(
                  (label) => (
                    <li
                      key={label}
                      className="text-muted-foreground inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium"
                    >
                      <CircleCheck className="text-success-strong size-3.5" />
                      {label}
                    </li>
                  ),
                )}
              </ul>
              <div className="text-sm leading-relaxed">
                <p>Hi Priya,</p>
                <p className="mt-2">
                  Yes. Annual plans can be refunded in full within 30 days of purchase or renewal, so your
                  renewal qualifies <Cite n={1} />. The refund goes back to your original payment method; your
                  bank can take 5 to 10 business days to show it <Cite n={1} />.
                </p>
                {!compact && (
                  <p className="mt-2">
                    To stop the plan renewing again, go to Settings &gt; Billing and choose Cancel plan{" "}
                    <Cite n={2} />.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <FakeButton primary>
                  <Send className="size-3.5" />
                  Approve &amp; send
                </FakeButton>
                <FakeButton>
                  <Pencil className="size-3.5" />
                  Edit
                </FakeButton>
                {!compact && (
                  <>
                    <FakeButton>
                      <RefreshCw className="size-3.5" />
                      Regenerate
                    </FakeButton>
                    <FakeButton>
                      <X className="size-3.5" />
                      Discard
                    </FakeButton>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {!compact && (
          <div className="bg-muted/30 hidden flex-col gap-4 border-l p-4 text-xs md:flex">
            <Property label="Status" value="Open" dot="bg-chart-1" />
            <Property label="Priority" value="Normal" />
            <Property label="Category" value="billing" />
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground">Sources</span>
              <span className="bg-background rounded-md border px-2 py-1.5">
                <span className="text-muted-foreground font-mono">1</span> Refund policy
              </span>
              <span className="bg-background rounded-md border px-2 py-1.5">
                <span className="text-muted-foreground font-mono">2</span> Cancel your subscription
              </span>
            </div>
            <div className="text-muted-foreground mt-auto border-t pt-3 leading-relaxed">
              AI triage set category and priority · 12 min ago
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <span className="bg-brand-subtle text-brand-strong inline-flex h-4 min-w-4 items-center justify-center rounded px-1 align-[1px] font-mono text-[10px] font-medium">
      {n}
    </span>
  );
}

function FakeButton({ children, primary = false }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium",
        primary ? "bg-primary text-primary-foreground border-transparent" : "bg-background",
      )}
    >
      {children}
    </span>
  );
}

function Property({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1.5 font-medium">
        {dot && <span className={cn("size-2 rounded-full", dot)} />}
        {value}
      </span>
    </div>
  );
}
