import { PenLine, Search, Send, Tag } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { ProductPreview } from "@/components/marketing/product-preview";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import {
  API_SPEC_PATH,
  ARCHITECTURE_URL,
  EVAL_METHOD_URL,
  EVAL_REPORT_URL,
  LANDING_METRICS,
  LANDING_METRICS_NOTE,
  REPO_URL,
} from "@/lib/landing";
import { parseThemePreference, THEME_COOKIE } from "@/lib/theme";

export const metadata: Metadata = {
  title: { absolute: "SupportPilot · Support replies drafted by AI, approved by your team" },
};

/**
 * What happens to a new ticket, told as the ticket's own activity trail (the product's object,
 * not a row of numbered feature cards). Demo times and names; the explanations are factual.
 */
const TRAIL = [
  {
    icon: Tag,
    actor: "AI triage",
    action: "set the category to billing and the priority to normal",
    time: "10:41",
    body: "Every new request gets a category, priority, language and sentiment. A label the model is less than 95% sure of is not applied; it waits for an agent instead.",
  },
  {
    icon: Search,
    actor: "Knowledge search",
    action: "found Refund policy and Cancel your subscription",
    time: "10:41",
    body: "Vector search over your help articles. If no passage is close enough to the question, no draft is written and the ticket stays with the team.",
  },
  {
    icon: PenLine,
    actor: "AI draft",
    action: "wrote a reply that cites 2 passages",
    time: "10:42",
    body: "Each claim cites a passage. The app checks every citation number against the passages the model was given, and flags any link the model made up.",
  },
  {
    icon: Send,
    actor: "Olivia Owner",
    action: "edited the draft and sent it",
    time: "10:46",
    body: "Nothing reaches the customer until an agent approves it, and every action is recorded in the audit log.",
  },
];

const ENGINEERING = [
  {
    title: "Multi-tenant by design",
    body: "Every query is scoped to a workspace, with role checks on the server and tests that another workspace's data returns 404.",
  },
  {
    title: "Strict by default",
    body: "Nonce-based Content Security Policy with no inline scripts or styles, hardened headers, rate-limited sign-in and validated API input.",
  },
  {
    title: "Tested end to end",
    body: "Unit, integration and browser tests, including automated accessibility checks in light and dark themes, run in CI.",
  },
  {
    title: "Observable",
    body: "OpenTelemetry traces for every AI call, structured logs with request IDs, and error reporting to Sentry.",
  },
  {
    title: "AI costs under control",
    body: "A monthly token budget per workspace, a daily call cap, timeouts, and a fallback model when the main one is overloaded.",
  },
  {
    title: "A documented REST API",
    body: "Versioned /api/v1 endpoints with Zod validation and an OpenAPI description, used by the app itself.",
  },
];

const FOOTER_LINKS = [
  { label: "Source code", href: REPO_URL },
  { label: "Evaluation report", href: EVAL_REPORT_URL },
  { label: "Architecture", href: ARCHITECTURE_URL },
  { label: "API description (OpenAPI)", href: API_SPEC_PATH },
];

const navLink =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-md px-2 py-1 text-sm outline-none focus-visible:ring-2";
const textLink =
  "text-foreground decoration-border hover:decoration-foreground focus-visible:ring-ring rounded-sm underline underline-offset-4 outline-none focus-visible:ring-2";

export default async function Home() {
  const theme = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <>
      <header className="bg-background/90 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <a href="#how-it-works" className={`${navLink} hidden md:inline`}>
              How it works
            </a>
            <a href="#evaluation" className={`${navLink} hidden md:inline`}>
              Evaluation
            </a>
            <a href={REPO_URL} className={`${navLink} hidden sm:inline`}>
              GitHub
            </a>
            <Link href="/sign-in" className={buttonVariants({ variant: "ghost", size: "lg" })}>
              Sign in
            </Link>
            <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
              Create account
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-4 pt-14 sm:px-6 sm:pt-20">
          <div className="flex max-w-3xl flex-col gap-5">
            <h1 className="text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.03em] text-balance sm:text-5xl lg:text-[3.5rem]">
              Support replies drafted by AI, approved by your team.
            </h1>
            <p className="text-muted-foreground max-w-2xl text-lg text-pretty">
              SupportPilot reads each new ticket, finds the help articles that answer it and drafts a reply
              that cites them. An agent checks every draft before anything reaches the customer.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Link href="/sign-up" className={buttonVariants({ size: "lg", className: "h-10 px-4" })}>
                Create a workspace
              </Link>
              <a
                href={REPO_URL}
                className={buttonVariants({
                  size: "lg",
                  variant: "outline",
                  className: "border-foreground/20 h-10 px-4",
                })}
              >
                View the source on GitHub
              </a>
            </div>
          </div>
        </section>

        <figure className="mx-auto w-full max-w-6xl px-4 pt-12 pb-20 sm:px-6">
          <ProductPreview />
          <figcaption className="text-muted-foreground mt-3 text-sm">
            The ticket screen with demo data: a draft that cites two help articles, its automatic checks, and
            the agent&apos;s choices. Nothing is sent until someone chooses Approve &amp; send.
          </figcaption>
        </figure>

        <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-14 border-t py-20">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <div className="flex max-w-xl flex-col gap-3">
              <h2 id="how-heading" className="text-3xl font-semibold tracking-tight text-balance">
                What happens to a new ticket
              </h2>
              <p className="text-muted-foreground">
                The agent sees each step on the ticket, in the order it happened. The AI suggests; a person
                decides what the customer gets.
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <p className="text-muted-foreground font-mono text-xs">Ticket #128 · demo data</p>
              <ol className="flex flex-col">
                {TRAIL.map(({ icon: Icon, actor, action, time, body }, i) => (
                  <li
                    key={actor}
                    className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-4 pb-8 last:pb-0"
                  >
                    {i < TRAIL.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="bg-border absolute top-8 bottom-1 left-[0.8125rem] w-px"
                      />
                    )}
                    <span
                      aria-hidden="true"
                      className="bg-background text-muted-foreground flex size-7 items-center justify-center rounded-full border"
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <div className="flex flex-col gap-1 pt-0.5">
                      <p className="text-sm">
                        <span className="font-medium">{actor}</span> {action}
                        <span className="text-muted-foreground ml-2 font-mono text-xs">{time}</span>
                      </p>
                      <p className="text-muted-foreground text-sm">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="evaluation" aria-labelledby="evaluation-heading" className="scroll-mt-14 border-t py-20">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 sm:px-6">
            <div className="flex max-w-2xl flex-col gap-3">
              <h2 id="evaluation-heading" className="text-3xl font-semibold tracking-tight text-balance">
                Measured on a labelled test set
              </h2>
              <p className="text-muted-foreground">
                Each result comes with its 95% confidence interval and the number of items it was measured on.
              </p>
            </div>
            <div
              role="region"
              aria-labelledby="evaluation-heading"
              tabIndex={0}
              className="focus-visible:ring-ring overflow-x-auto rounded-lg border outline-none focus-visible:ring-2"
            >
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">
                  Evaluation results with 95% confidence intervals, targets and sample sizes
                </caption>
                <thead className="bg-muted/50 text-muted-foreground text-left">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Measure
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      Result
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      95% range
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      Target
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      Measured on
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y border-t">
                  {LANDING_METRICS.map((m) => (
                    <tr key={m.label}>
                      <th scope="row" className="px-4 py-3 text-left font-normal">
                        {m.label}
                      </th>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{m.result}</td>
                      <td className="text-muted-foreground px-4 py-3 text-right tabular-nums">{m.range}</td>
                      <td className="text-muted-foreground px-4 py-3 text-right tabular-nums">{m.target}</td>
                      <td className="text-muted-foreground px-4 py-3 text-right whitespace-nowrap tabular-nums">
                        {m.n}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground max-w-3xl text-sm">{LANDING_METRICS_NOTE}</p>
              <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <a href={EVAL_REPORT_URL} className={textLink}>
                  Read the evaluation report
                </a>
                <a href={EVAL_METHOD_URL} className={textLink}>
                  How it is measured
                </a>
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="engineering-heading" className="border-t py-20">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 sm:px-6">
            <div className="flex max-w-2xl flex-col gap-3">
              <h2 id="engineering-heading" className="text-3xl font-semibold tracking-tight text-balance">
                Built like production software
              </h2>
              <p className="text-muted-foreground">
                Next.js 16, React 19 and TypeScript on PostgreSQL with pgvector, with Google Gemini for the AI
                and Vitest and Playwright for the tests.
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {ENGINEERING.map((e) => (
                <li key={e.title} className="flex flex-col gap-1.5 border-t pt-4">
                  <h3 className="font-semibold">{e.title}</h3>
                  <p className="text-muted-foreground text-sm">{e.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="start-heading" className="border-t py-20">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div className="flex max-w-xl flex-col gap-2">
              <h2 id="start-heading" className="text-2xl font-semibold tracking-tight">
                Try it with your own help articles
              </h2>
              <p className="text-muted-foreground">
                Create a workspace, upload a few Markdown or PDF articles, and send a request through your
                support portal.
              </p>
            </div>
            <Link href="/sign-up" className={buttonVariants({ size: "lg", className: "h-10 px-4" })}>
              Create a workspace
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-col items-start gap-3">
            <Logo />
            <p className="text-muted-foreground max-w-sm">
              A portfolio project by{" "}
              <a href="https://github.com/HamayunKhan800" className={textLink}>
                Hamayun Khan
              </a>
              . Open source under the MIT licence.
            </p>
          </div>
          <div className="flex flex-col gap-6 md:items-end">
            <nav aria-label="Project">
              <ul className="-mx-2 flex flex-col gap-1 md:items-end">
                {FOOTER_LINKS.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className={navLink}>
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <ThemeToggle initial={theme} />
          </div>
        </div>
      </footer>
    </>
  );
}
