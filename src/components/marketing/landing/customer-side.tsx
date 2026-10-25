"use client";

import { Inbox, Link2 } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { Chip, Initials } from "./mock";

/**
 * The customer's side, working (design step 9.3): the company's support form takes a sample
 * request, answers with the portal's own confirmation ("Request received", "Your private tracking
 * link"), and the request lands at the top of the team's inbox. Labels match the real portal
 * (/p/{slug}) and tracking page (/t/{token}). Nothing is sent anywhere; the demo says so.
 */

function Phone({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground land-shadow w-[16.5rem] overflow-hidden rounded-[2rem] border-[6px] border-[color-mix(in_oklab,var(--foreground)_88%,transparent)] text-left",
        className,
      )}
    >
      <div aria-hidden="true" className="flex h-6 items-center justify-center">
        <span className="bg-foreground/80 h-1.5 w-16 rounded-full" />
      </div>
      <div className="flex flex-col gap-3 px-4 pt-1 pb-5 text-xs">{children}</div>
    </div>
  );
}

const fieldClass =
  "bg-background field-focus w-full rounded-md border px-2 py-1.5 text-base leading-snug sm:text-xs aria-[invalid=true]:border-danger-border";

function Field({
  label,
  name,
  value,
  onChange,
  invalid,
  tall = false,
}: {
  label: string;
  name: keyof Draft;
  value: string;
  onChange: (name: keyof Draft, value: string) => void;
  invalid: boolean;
  tall?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium">{label}</span>
      {tall ? (
        <textarea
          name={name}
          rows={3}
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(name, e.target.value)}
          className={cn(fieldClass, "resize-none")}
        />
      ) : (
        <input
          name={name}
          type={name === "email" ? "email" : "text"}
          autoComplete="off"
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(name, e.target.value)}
          className={fieldClass}
        />
      )}
    </label>
  );
}

interface Draft {
  name: string;
  email: string;
  subject: string;
  message: string;
}

const SAMPLE: Draft = {
  name: "Priya Shah",
  email: "priya@example.com",
  subject: "Refund for my annual plan",
  message: "My annual plan renewed 12 days ago and I didn't mean to keep it. Can I get my money back?",
};

const EARLIER = [
  { n: 130, subject: "Vocês vendem licença vitalícia?", who: "Marta Silva", when: "4m" },
  { n: 129, subject: "Can I add a second admin to our plan?", who: "Daniel Kim", when: "9m" },
];

function invalidFields(d: Draft): (keyof Draft)[] {
  const out: (keyof Draft)[] = [];
  if (!d.name.trim()) out.push("name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) out.push("email");
  if (!d.subject.trim()) out.push("subject");
  if (!d.message.trim()) out.push("message");
  return out;
}

export function CustomerSide() {
  const [draft, setDraft] = useState<Draft>(SAMPLE);
  const [sent, setSent] = useState<Draft | null>(null);
  const [tried, setTried] = useState(false);
  const invalid = tried ? invalidFields(draft) : [];
  // Focus follows the swap between the form and the confirmation, so a keyboard user stays put.
  const [resets, setResets] = useState(0);
  const done = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (sent) done.current?.focus();
  }, [sent]);
  useEffect(() => {
    if (resets > 0) form.current?.querySelector("input")?.focus();
  }, [resets]);

  const change = (name: keyof Draft, value: string) => setDraft((d) => ({ ...d, [name]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalidFields(draft).length === 0) setSent(draft);
  };
  const reset = () => {
    setSent(null);
    setTried(false);
    setDraft(SAMPLE);
    setResets((n) => n + 1);
  };

  return (
    <div className="relative mx-auto flex w-full max-w-md flex-col items-center gap-6 sm:block sm:h-[33rem]">
      <Phone className={cn("sm:absolute sm:top-0 sm:left-2", !sent && "sm:z-10")}>
        <span className="flex items-center gap-1.5 font-semibold">
          <LogoMark className="size-4 [&_svg]:size-3.5" />
          Nimbus Cloud Storage
        </span>
        {sent ? (
          <div ref={done} tabIndex={-1} className="land-in flex flex-col gap-3" role="status">
            <span className="text-base leading-tight font-semibold">Request received</span>
            <span className="text-muted-foreground leading-snug">
              Thanks, {sent.name.trim().split(/\s+/)[0]}. We&apos;ll reply on this page.
            </span>
            <span className="flex flex-col gap-1">
              <span className="font-medium">Your private tracking link</span>
              <span className="bg-background text-muted-foreground flex items-center gap-1.5 rounded-md border px-2 py-1.5 font-mono text-[11px]">
                <Link2 aria-hidden="true" className="size-3 shrink-0" />
                …/t/<span aria-hidden="true">••••••••</span>
                <span className="sr-only">followed by a secret code</span>
              </span>
            </span>
            <button
              type="button"
              onClick={reset}
              className="hover:bg-muted min-h-8 cursor-pointer rounded-md border px-3 font-medium transition-colors"
            >
              Send another
            </button>
          </div>
        ) : (
          <form
            method="post"
            ref={form}
            noValidate
            onSubmit={submit}
            aria-label="Demo support form"
            className="flex flex-col gap-3"
          >
            <span className="text-base leading-tight font-semibold">Contact support</span>
            <Field
              label="Your name"
              name="name"
              value={draft.name}
              onChange={change}
              invalid={invalid.includes("name")}
            />
            <Field
              label="Email"
              name="email"
              value={draft.email}
              onChange={change}
              invalid={invalid.includes("email")}
            />
            <Field
              label="Subject"
              name="subject"
              value={draft.subject}
              onChange={change}
              invalid={invalid.includes("subject")}
            />
            <Field
              label="How can we help?"
              name="message"
              value={draft.message}
              onChange={change}
              invalid={invalid.includes("message")}
              tall
            />
            {invalid.length > 0 && (
              <span role="alert" className="text-danger-strong">
                Fill in every field, with a valid email.
              </span>
            )}
            <button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary/90 min-h-8 cursor-pointer rounded-md px-3 font-medium transition-colors"
            >
              Send request
            </button>
          </form>
        )}
      </Phone>

      {sent ? (
        <div
          role="group"
          aria-label="The support team's inbox"
          className="bg-card text-card-foreground land-shadow land-pop w-full max-w-[18rem] overflow-hidden rounded-xl border text-left text-xs sm:absolute sm:top-[15.5rem] sm:right-0 sm:z-20"
        >
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <Inbox aria-hidden="true" className="text-muted-foreground size-3.5" />
            <span className="font-semibold">Tickets</span>
            <span className="text-muted-foreground ml-auto">Nimbus Cloud</span>
          </div>
          <ul>
            <li className="bg-accent/60 land-in flex flex-col gap-1 border-b px-3 py-2.5">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{sent.subject.trim()}</span>
                <span className="text-muted-foreground ml-auto shrink-0">now</span>
              </span>
              <span className="text-muted-foreground flex items-center gap-2">
                #131 · {sent.name.trim()}
                <Chip className="ml-auto">New</Chip>
              </span>
            </li>
            {EARLIER.map((t) => (
              <li
                key={t.n}
                aria-hidden="true"
                className="flex flex-col gap-1 border-b px-3 py-2.5 last:border-b-0"
              >
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground truncate">{t.subject}</span>
                  <span className="text-muted-foreground ml-auto shrink-0">{t.when}</span>
                </span>
                <span className="text-muted-foreground">
                  #{t.n} · {t.who}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground border-t px-3 py-2 leading-snug">
            AI triage runs next. Demo only: nothing left your browser.
          </p>
        </div>
      ) : (
        <div aria-hidden="true" className="hidden select-none sm:block">
          <Phone className="sm:absolute sm:top-16 sm:right-2">
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
                  Yes. Annual plans can be refunded in full within 30 days of renewal, so yours qualifies.
                  Your bank can take 5 to 10 business days to show it.
                </span>
              </span>
            </span>
          </Phone>
        </div>
      )}
    </div>
  );
}
