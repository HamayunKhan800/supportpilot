import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { ProductPreview } from "@/components/marketing/product-preview";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { EVAL_METHOD_URL, LANDING_METRICS, LANDING_METRICS_NOTE, REPO_URL } from "@/lib/landing";
import { parseThemePreference, THEME_COOKIE } from "@/lib/theme";

export const metadata: Metadata = {
  title: { absolute: "SupportPilot · Support replies grounded in your help centre" },
};

const STEPS = [
  {
    title: "Triage",
    body: "Each new request gets a category, priority, language and sentiment. Labels the model is unsure about wait for an agent as “Needs review”.",
  },
  {
    title: "Retrieve",
    body: "Keyword and vector search over your help articles, merged with reciprocal rank fusion. If no passage scores above the floor, no draft is written.",
  },
  {
    title: "Draft",
    body: "The model writes a reply that cites a passage for each claim. Citation numbers are checked against the passages it was given; links it invents are flagged.",
  },
  {
    title: "Approve",
    body: "An agent edits, approves or discards the draft. Nothing reaches the customer without that step, and every action lands in the audit log.",
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

const navLink =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-md px-2 py-1 text-sm outline-none focus-visible:ring-2";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground font-mono text-xs font-medium tracking-wider uppercase">{children}</p>
  );
}

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
        {/* Hero */}
        <section className="mx-auto w-full max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24">
          <div className="flex max-w-3xl flex-col gap-6">
            <a
              href={REPO_URL}
              className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs outline-none focus-visible:ring-2"
            >
              Open-source portfolio project
              <ArrowRight aria-hidden="true" className="size-3" />
            </a>
            <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Support replies grounded in your help centre.{" "}
              <span className="text-muted-foreground">Approved by a person before they&apos;re sent.</span>
            </h1>
            <p className="text-muted-foreground max-w-2xl text-lg text-pretty">
              SupportPilot triages incoming tickets, finds the help articles that answer them and drafts a
              reply that cites each source. Your team checks the draft, edits it if needed, and decides what
              goes out.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/sign-up" className={buttonVariants({ size: "lg", className: "h-10 px-4" })}>
                Create a workspace
                <ArrowRight aria-hidden="true" />
              </Link>
              <a
                href={REPO_URL}
                className={buttonVariants({ size: "lg", variant: "outline", className: "h-10 px-4" })}
              >
                Read the code
                <ArrowUpRight aria-hidden="true" />
              </a>
            </div>
            <p className="text-muted-foreground font-mono text-xs">
              Next.js · TypeScript · PostgreSQL with pgvector · Google Gemini
            </p>
          </div>
        </section>

        <figure className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
          <ProductPreview />
          <figcaption className="text-muted-foreground mt-3 text-sm">
            The ticket screen with demo content: an AI draft that cites two help articles, its automatic
            checks, and the agent&apos;s choices. Nothing is sent until someone chooses Approve &amp; send.
          </figcaption>
        </figure>

        {/* How it works */}
        <section
          id="how-it-works"
          aria-labelledby="how-heading"
          className="bg-muted/30 scroll-mt-14 border-y py-20"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 sm:px-6">
            <div className="flex max-w-2xl flex-col gap-3">
              <Eyebrow>How it works</Eyebrow>
              <h2 id="how-heading" className="text-3xl font-semibold tracking-tight text-balance">
                From a new ticket to an approved reply
              </h2>
              <p className="text-muted-foreground">
                Four steps, each one visible to the agent. The AI suggests; people decide.
              </p>
            </div>
            <ol className="bg-border grid grid-cols-1 gap-px overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ title, body }, i) => (
                <li key={title} className="bg-card flex flex-col gap-2 p-5">
                  <span aria-hidden="true" className="text-brand-strong font-mono text-xs font-medium">
                    0{i + 1}
                  </span>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="text-muted-foreground text-sm">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Evaluation */}
        <section id="evaluation" aria-labelledby="evaluation-heading" className="scroll-mt-14 py-20">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 sm:px-6">
            <div className="flex max-w-2xl flex-col gap-3">
              <Eyebrow>Evaluation</Eyebrow>
              <h2 id="evaluation-heading" className="text-3xl font-semibold tracking-tight text-balance">
                Measured, not promised
              </h2>
              <p className="text-muted-foreground">
                The AI is tested against a labelled set of help-centre questions and support tickets. Each
                number comes with how many items it was measured on and its 95% confidence interval.
              </p>
            </div>
            <dl className="bg-border grid grid-cols-1 gap-px overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-4">
              {LANDING_METRICS.map((m) => (
                <div key={m.value + m.label} className="bg-card flex flex-col gap-2 p-5">
                  <dt className="sr-only">{m.label}</dt>
                  <dd className="text-4xl font-semibold tracking-tight tabular-nums">{m.value}</dd>
                  <dd className="text-sm">{m.label}</dd>
                  <dd className="text-muted-foreground mt-auto pt-2 font-mono text-xs">{m.detail}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
              <p className="text-muted-foreground max-w-3xl text-sm">{LANDING_METRICS_NOTE}</p>
              <a
                href={EVAL_METHOD_URL}
                className={buttonVariants({
                  variant: "outline",
                  size: "lg",
                  className: "h-10 shrink-0 px-4",
                })}
              >
                How it is measured
                <ArrowUpRight aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        {/* Engineering */}
        <section aria-labelledby="engineering-heading" className="bg-muted/30 border-y py-20">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 sm:px-6">
            <div className="flex max-w-2xl flex-col gap-3">
              <Eyebrow>Engineering</Eyebrow>
              <h2 id="engineering-heading" className="text-3xl font-semibold tracking-tight text-balance">
                Built like production software
              </h2>
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

        {/* Closing call to action */}
        <section aria-labelledby="start-heading" className="py-20">
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
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            SupportPilot is a portfolio project by Hamayun Khan.{" "}
            <a href={REPO_URL} className="hover:text-foreground underline underline-offset-4">
              Source on GitHub
            </a>
            .
          </p>
          <ThemeToggle initial={theme} />
        </div>
      </footer>
    </>
  );
}
