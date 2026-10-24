import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { PortalFrame } from "@/components/portal/portal-frame";
import { initials } from "@/lib/initials";
import { CUSTOMER_STATUS_LABEL } from "@/server/modules/tickets/limits";
import { getCustomerTicket } from "@/server/modules/tickets/service";
import { AppError } from "@/server/platform/errors";
import { ReplyForm } from "./reply-form";

/**
 * The customer's private tracking page (plan D1). The URL holds a secret, so:
 * - never indexed or cached (dynamic page → Cache-Control: no-store)
 * - no Referer to any site (proxy header + meta tag below)
 * - the title and page never repeat the token, and logs record no paths
 */
export const metadata: Metadata = {
  title: "Your support request",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

async function load(token: string) {
  try {
    return await getCustomerTicket(token);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return null;
    throw err;
  }
}

export default async function TrackingPage({ params }: PageProps<"/t/[token]">) {
  const { token } = await params;
  const ticket = await load(token);
  if (!ticket) notFound();

  return (
    <PortalFrame workspaceName={ticket.workspaceName} narrow>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-muted-foreground font-mono text-xs">Request #{ticket.number}</p>
          <h1 className="text-2xl font-semibold tracking-tight break-words">{ticket.subject}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <Badge variant={ticket.status === "pending" ? "default" : "secondary"}>
              <span className="sr-only">Status: </span>
              {CUSTOMER_STATUS_LABEL[ticket.status]}
            </Badge>
            <span className="text-muted-foreground">{STATUS_HINT[ticket.status]}</span>
          </div>
          <p className="text-muted-foreground text-sm">
            Opened <time dateTime={ticket.createdAt.toISOString()}>{fmt.format(ticket.createdAt)} UTC</time>
          </p>
        </header>

        <section aria-labelledby="conversation-heading" className="flex flex-col gap-4">
          <h2 id="conversation-heading" className="text-lg font-semibold">
            Conversation
          </h2>
          <ol className="flex flex-col">
            {ticket.messages.map((m, i) => {
              const support = m.from === "support";
              const who = support
                ? m.authorName
                  ? `${m.authorName} (support team)`
                  : "Support team"
                : "You";
              const last = i === ticket.messages.length - 1;
              return (
                <li key={m.id} className="relative flex gap-3 pb-6 last:pb-0">
                  {/* The thread line joins each avatar to the next message. */}
                  {!last && (
                    <span aria-hidden="true" className="bg-border absolute top-9 bottom-1 left-[15px] w-px" />
                  )}
                  <span
                    aria-hidden="true"
                    className={
                      support
                        ? "bg-brand-subtle text-brand-strong border-brand-border flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
                        : "bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
                    }
                  >
                    {support ? initials(m.authorName ?? ticket.workspaceName) : "You"}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <p className="flex flex-wrap items-baseline gap-x-2 pt-1.5 text-sm">
                      <span className="font-medium">{who}</span>
                      <time dateTime={m.createdAt.toISOString()} className="text-muted-foreground text-xs">
                        {fmt.format(m.createdAt)} UTC
                      </time>
                    </p>
                    {/* Plain text (plan D8): React escapes it; whitespace is preserved for readability. */}
                    <div
                      className={
                        support
                          ? "bg-card rounded-lg border px-4 py-3 shadow-xs"
                          : "bg-muted/50 rounded-lg border px-4 py-3"
                      }
                    >
                      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{m.body}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {ticket.canReply ? (
          <ReplyForm token={token} />
        ) : (
          <p className="text-muted-foreground bg-muted/50 rounded-lg border p-4 text-sm">
            This request is closed, so replies are turned off. If you need more help, please submit a new
            request.
          </p>
        )}
        <p className="text-muted-foreground border-t pt-4 text-xs">
          Keep this page&apos;s link private: anyone who has it can read this conversation.
        </p>
      </div>
    </PortalFrame>
  );
}

/** One line under the status, in the customer's terms. Never mentions the team's own notes. */
const STATUS_HINT = {
  open: "Our team has your request and will reply here.",
  pending: "We've replied and are waiting to hear from you.",
  resolved: "We think this is sorted. Reply below if you still need help.",
  closed: "This request is finished.",
} as const;
