import type { ReactNode } from "react";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { FakeButton, Initials } from "./mock";

/**
 * Two phones, layered: the company's support form at the back, the private tracking page in front.
 * Labels match the real portal (/p/{slug}) and tracking page (/t/{token}); demo content.
 */

function Phone({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground land-shadow w-[16.5rem] overflow-hidden rounded-[2rem] border-[6px] border-[color-mix(in_oklab,var(--foreground)_88%,transparent)] text-left",
        className,
      )}
    >
      <div className="flex h-6 items-center justify-center">
        <span className="bg-foreground/80 h-1.5 w-16 rounded-full" />
      </div>
      <div className="flex flex-col gap-3 px-4 pt-1 pb-5 text-xs">{children}</div>
    </div>
  );
}

function Field({ label, value, tall = false }: { label: string; value: string; tall?: boolean }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="font-medium">{label}</span>
      <span
        className={cn(
          "bg-background text-muted-foreground rounded-md border px-2 py-1.5 leading-snug",
          tall && "min-h-14",
        )}
      >
        {value}
      </span>
    </span>
  );
}

export function CustomerSide() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-[33rem] w-full max-w-md select-none">
      <Phone className="absolute top-0 left-0 sm:left-2">
        <span className="flex items-center gap-1.5 font-semibold">
          <LogoMark className="size-4 [&_svg]:size-3.5" />
          Nimbus Cloud Storage
        </span>
        <span className="text-base leading-tight font-semibold">Contact support</span>
        <Field label="Your name" value="Priya Shah" />
        <Field label="Email" value="priya@example.com" />
        <Field label="Subject" value="Refund for my annual plan" />
        <Field
          label="How can we help?"
          value="My annual plan renewed 12 days ago and I didn't mean to keep it…"
          tall
        />
        <FakeButton primary className="justify-center">
          Send request
        </FakeButton>
      </Phone>

      <Phone className="absolute top-16 right-0 sm:right-2">
        <span className="text-muted-foreground">Nimbus Cloud Storage · #128</span>
        <span className="text-base leading-tight font-semibold">Refund for my annual plan</span>
        <span className="border-warning-border bg-warning-subtle text-warning-strong inline-flex w-fit items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium">
          Waiting for your reply
        </span>
        <span className="flex gap-2">
          <Initials name="Priya Shah" className="size-5 text-[9px]" />
          <span className="bg-background rounded-lg border px-2.5 py-2 leading-snug">
            Can I get my money back, and how long does it take?
          </span>
        </span>
        <span className="flex gap-2">
          <Initials name="Olivia Owner" className="size-5 text-[9px]" />
          <span className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[11px]">Olivia Owner (support team)</span>
            <span className="bg-muted rounded-lg border px-2.5 py-2 leading-snug">
              Yes. Annual plans can be refunded in full within 30 days of renewal, so yours qualifies. Your
              bank can take 5 to 10 business days to show it.
            </span>
          </span>
        </span>
        <Field label="Your reply" value="Thank you, that's all I needed." />
        <FakeButton primary className="justify-center">
          Send reply
        </FakeButton>
      </Phone>
    </div>
  );
}
