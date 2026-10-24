import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:py-16">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium">{ticket.workspaceName} support</p>
        <h1 className="text-2xl font-semibold tracking-tight break-words">{ticket.subject}</h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span>Request #{ticket.number}</span>
          <Badge variant={ticket.status === "pending" ? "default" : "secondary"}>
            <span className="sr-only">Status: </span>
            {CUSTOMER_STATUS_LABEL[ticket.status]}
          </Badge>
          <span>
            Opened <time dateTime={ticket.createdAt.toISOString()}>{fmt.format(ticket.createdAt)} UTC</time>
          </span>
        </div>
      </header>

      <section aria-labelledby="conversation-heading" className="flex flex-col gap-3">
        <h2 id="conversation-heading" className="text-lg font-semibold">
          Conversation
        </h2>
        <ol className="flex flex-col gap-3">
          {ticket.messages.map((m) => (
            <li key={m.id}>
              <Card className={m.from === "support" ? "border-l-brand-strong border-l-4" : undefined}>
                <CardContent className="flex flex-col gap-2">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <span className="font-medium">
                      {m.from === "customer"
                        ? "You"
                        : m.authorName
                          ? `${m.authorName} (support team)`
                          : "Support team"}
                    </span>
                    <time dateTime={m.createdAt.toISOString()} className="text-muted-foreground">
                      {fmt.format(m.createdAt)} UTC
                    </time>
                  </p>
                  {/* Plain text (plan D8): React escapes it; whitespace is preserved for readability. */}
                  <p className="break-words whitespace-pre-wrap">{m.body}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {ticket.canReply ? (
        <ReplyForm token={token} />
      ) : (
        <p className="text-muted-foreground rounded-lg border p-4 text-sm">
          This request is closed, so replies are turned off. If you need more help, please submit a new
          request.
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        Keep this page&apos;s link private: anyone who has it can read this conversation.
      </p>
    </main>
  );
}
