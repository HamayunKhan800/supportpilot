import { BookOpen, Check, History, RefreshCw, Settings2, Undo2, Users } from "lucide-react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import Link from "next/link";
import { Fragment } from "react";
import { Logo } from "@/components/logo";
import { ApiSample } from "@/components/marketing/landing/api-sample";
import { CustomerSide } from "@/components/marketing/landing/customer-side";
import { EvalResults } from "@/components/marketing/landing/eval-results";
import { Guardrails } from "@/components/marketing/landing/guardrails";
import { HeroHeadline } from "@/components/marketing/landing/hero-headline";
import { HeroLive } from "@/components/marketing/landing/hero-live";
import { LandingHeader } from "@/components/marketing/landing/landing-header";
import { MobileMenu } from "@/components/marketing/landing/mobile-menu";
import { Reveal } from "@/components/marketing/landing/reveal";
import { Spotlight } from "@/components/marketing/landing/spotlight";
import { PaletteScene } from "@/components/marketing/landing/team-tools";
import { WORKFLOW_STEPS } from "@/components/marketing/landing/workflow-scenes";
import { WorkflowTabs } from "@/components/marketing/landing/workflow-tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import {
  API_SPEC_PATH,
  ARCHITECTURE_URL,
  EVAL_METHOD_URL,
  EVAL_REPORT_URL,
  ASVS_URL,
  HERO_FOOTNOTES,
  LANDING_METRICS_NOTE,
  REPO_URL,
} from "@/lib/landing";
import { parseThemePreference, THEME_COOKIE } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** The hero at the top is always dark, so the address bar is too, whatever the theme. */

export const metadata: Metadata = {
  title: { absolute: "SupportPilot · Support replies drafted by AI, approved by your team" },
};

/*
 * The landing page (docs/design/landing.md). Ink bands (hero, guardrails, closing) alternate with
 * light working sections; the product is the picture throughout, built from the app's own tokens
 * and labels. Every claim on the page is something the code does or a measured result with its
 * sample size; there are no customer logos, testimonials or invented numbers.
 */

/** Technologies the project is built on (package.json, Dockerfile, observability setup). */
const STACK = [
  "Next.js",
  "React",
  "TypeScript",
  "PostgreSQL",
  "pgvector",
  "Google Gemini",
  "OpenTelemetry",
  "Sentry",
  "Docker",
  "Playwright",
];

/** The usual way against what SupportPilot does, row by row. */
const CONTRAST = [
  {
    before: "An agent reads the ticket, then decides who should handle it and how urgent it is.",
    after:
      "Category, priority, sentiment and language are suggested as the ticket arrives, and applied when the model is confident enough.",
  },
  {
    before: "The answer is in the help centre, so someone searches for it and retypes it.",
    after: "One click drafts a reply from the closest help-centre passages, with each claim cited.",
  },
  {
    before: "An AI that answers on its own can sound sure and still be wrong.",
    after: "Citations are checked, weak matches mean no draft, and a person approves every reply.",
  },
  {
    before: "Customers need an account, or follow up by email and lose the thread.",
    after: "A support form for each company and a private link to follow and answer the conversation.",
  },
];

const TEAM_FEATURES = [
  {
    icon: RefreshCw,
    title: "Live without reloading",
    body: "Open pages check for new tickets and replies every 15 seconds while visible, never while you type.",
  },
  {
    icon: Undo2,
    title: "Instant changes with Undo",
    body: "Status, priority, category and assignee save as you change them. Edits by someone else are detected.",
  },
  {
    icon: BookOpen,
    title: "Knowledge from your files",
    body: "Upload Markdown, text or PDF articles. They are split into passages and indexed in the background.",
  },
  {
    icon: Settings2,
    title: "AI settings per workspace",
    body: "Switch AI off, set a monthly token budget, the auto-apply threshold, the match score and categories.",
  },
  {
    icon: Users,
    title: "Roles and invitations",
    body: "Owners, admins and agents, checked on the server for every action. New members join through an invitation.",
  },
  {
    icon: History,
    title: "Audit log and analytics",
    body: "Who changed what and when, plus AI usage, estimated cost and what happened to each draft.",
  },
];

const ENGINEERING = [
  "Every query scoped to a workspace, with tests that other workspaces' data returns 404",
  "Nonce-based Content Security Policy: no inline scripts or styles",
  "Versioned REST API with Zod validation and an OpenAPI description",
  "Unit, integration and browser tests with axe accessibility checks in CI",
  "OpenTelemetry traces for every AI call, structured logs and Sentry",
  "Rate-limited sign-in, validated input and hardened headers",
  "Self-reviewed against OWASP ASVS 5.0 Level 2: 183 of 194 applicable checks pass",
];

const FOOTER_PRODUCT = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Guardrails", href: "#guardrails" },
  { label: "Evaluation", href: "#evaluation" },
];

const FOOTER_PROJECT = [
  { label: "Source code", href: REPO_URL },
  { label: "Evaluation report", href: EVAL_REPORT_URL },
  { label: "Architecture", href: ARCHITECTURE_URL },
  { label: "API description (OpenAPI)", href: API_SPEC_PATH },
];

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#guardrails", label: "Guardrails" },
  { href: "#evaluation", label: "Evaluation" },
  { href: REPO_URL, label: "GitHub" },
];
const navLink =
  "text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1.5 text-sm transition-colors";
const textLink =
  "text-foreground decoration-foreground/30 hover:decoration-foreground rounded-sm underline underline-offset-4 transition-colors";
const container = "mx-auto w-full max-w-6xl px-4 sm:px-6";
const h2 =
  "font-display text-3xl font-normal tracking-[-0.015em] text-balance sm:text-[2.5rem] sm:leading-[1.1]";
/**
 * Newsreader (SIL Open Font License, src/app/fonts/Newsreader-OFL.txt) for the landing page's
 * display headings only; body text and the app stay Geist. One 57 KB Latin file, regular weight,
 * with the optical-size axis so large headings use the display cut. Self-hosted, so
 * `font-src 'self'` holds; the metric-matched Times New Roman fallback limits reflow on load.
 */
const newsreader = localFont({
  src: "./fonts/newsreader-latin-400.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-newsreader",
  fallback: ["ui-serif", "Georgia", "Times New Roman", "serif"],
  adjustFontFallback: "Times New Roman",
});
const lead = "text-muted-foreground text-base leading-relaxed text-pretty sm:text-lg";

/** The Handoff mark drawn as two outlines, large and faint: the closing section's backdrop. */
function HandoffMotif({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className} focusable="false">
      <circle
        cx="9"
        cy="12"
        r="6.5"
        stroke="currentColor"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x="11"
        y="7"
        width="10"
        height="10"
        stroke="currentColor"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// The headline, word by word: each word arrives blur-to-sharp in turn (design step 10.2).
// Delays are literal classes so Tailwind can see them; the text reads the same to assistive tech.
/*
 * The headline types itself out like a reply being drafted, then deletes and types again, with a
 * Pause button (hero-headline.tsx; globals.css, "type-ch"). Each
 * character is painted from the first frame as faint ghost text and turns solid in turn, so the
 * layout never moves and the largest paint is not delayed. Screen readers and search engines get
 * the sentence once, from the sr-only copy. Classes are literal so Tailwind can see them.
 */
const HEADLINE_A = "Support replies drafted by AI, ";
const HEADLINE_B = "approved by your team.";
const CHAR_INDEX = [
  "[--n:0]",
  "[--n:1]",
  "[--n:2]",
  "[--n:3]",
  "[--n:4]",
  "[--n:5]",
  "[--n:6]",
  "[--n:7]",
  "[--n:8]",
  "[--n:9]",
  "[--n:10]",
  "[--n:11]",
  "[--n:12]",
  "[--n:13]",
  "[--n:14]",
  "[--n:15]",
  "[--n:16]",
  "[--n:17]",
  "[--n:18]",
  "[--n:19]",
  "[--n:20]",
  "[--n:21]",
  "[--n:22]",
  "[--n:23]",
  "[--n:24]",
  "[--n:25]",
  "[--n:26]",
  "[--n:27]",
  "[--n:28]",
  "[--n:29]",
  "[--n:30]",
  "[--n:31]",
];
/** A short pause after "AI," before the second half, as a person typing would. */
const LINE_B_OFFSET = "[--o:37]";

/**
 * A footnote number in the headline: a real link to the source under the waterline (typeset after
 * the punctuation, as footnotes are). The hit area is at least 24 px (WCAG 2.5.8).
 */
function FootnoteRef({ n }: { n: number }) {
  return (
    <sup className="ml-[0.04em] align-super font-sans text-[max(0.36em,0.875rem)] leading-none font-medium">
      <a
        href={`#source-${n}`}
        aria-label={`Source ${n}`}
        className="inline-flex min-h-6 min-w-6 items-center justify-start rounded-sm tabular-nums underline-offset-4 hover:underline"
      >
        {n}
      </a>
    </sup>
  );
}

function TypedChars({ text, last = false }: { text: string; last?: boolean }) {
  return Array.from(text).map((ch, i) => (
    <span
      key={i}
      className={cn(
        "type-ch",
        CHAR_INDEX[i],
        ch === " " && "type-sp",
        last && i === text.length - 1 && "type-ch-last",
      )}
    >
      {ch}
    </span>
  ));
}

export default async function Home() {
  const theme = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <>
      <Reveal />
      <Spotlight />
      <LandingHeader>
        <div className={cn(container, "flex h-16 items-center gap-8")}>
          {/* 64 px bar, 28 px mark and 18 px name, as on Vercel and Linear (measured 2026-10-25). */}
          <Logo className="gap-2.5 text-lg [&_svg]:size-7" />
          {/* As on Vercel, Resend, Attio and Clerk: section links beside the logo, the two calls to
              action at the far right. On phones both move into the menu (mobile-menu.tsx). */}
          <nav aria-label="Main" className="hidden flex-1 items-center gap-1 md:flex">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className={cn(navLink, l.href === REPO_URL && "hidden lg:inline")}
              >
                {l.label}
              </a>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <Link href="/sign-in" className={buttonVariants({ variant: "ghost", className: "px-3" })}>
                Sign in
              </Link>
              <Link href="/sign-up" className={buttonVariants({ className: "px-3" })}>
                Sign up
              </Link>
            </div>
          </nav>
          <div className="ml-auto md:hidden">
            <MobileMenu links={NAV_LINKS} />
          </div>
        </div>
      </LandingHeader>

      {/* The header stays pinned at every width here, so a control that focus scrolls to stays
          below it (WCAG 2.2 2.4.11); globals.css does the same for narrow screens app-wide. */}
      <main
        id="main"
        className={cn(newsreader.variable, "flex-1 [&_:is(a,button,input,summary)]:scroll-mt-20")}
      >
        {/* Hero: the waterline. The headline's claims carry footnote numbers, as a drafted reply
            carries its sources; the footnotes sit under the seam (DESIGN.md, "The Cited Draft"). */}
        <section
          aria-labelledby="hero-heading"
          className="relative isolate -mt-16 flex min-h-svh flex-col overflow-hidden pt-16"
        >
          <div
            data-theme="dark"
            className={cn(container, "relative flex flex-1 flex-col pt-20 sm:pt-28 lg:pt-32")}
          >
            <HeroHeadline
              id="hero-heading"
              labelledBy="hero-sentence"
              className="font-display text-[2.5rem] leading-[1.05] font-normal tracking-[-0.02em] sm:text-[3.5rem] lg:text-[4.5rem] xl:text-[5rem]"
            >
              <span id="hero-sentence" className="sr-only">
                {HEADLINE_A + HEADLINE_B}
              </span>
              {/* Line one stays in the page's colours inside the dark-themed hero. */}
              <span className="text-foreground block pb-[0.16em] text-balance [--foreground:var(--page-foreground)]">
                <span aria-hidden="true">
                  <TypedChars text={HEADLINE_A.trimEnd()} />
                </span>
                <FootnoteRef n={1} />
              </span>
              <span className="hero-water text-foreground block pt-[0.2em] text-balance">
                <span aria-hidden="true" className="hero-water-fill" />
                <span aria-hidden="true" className={LINE_B_OFFSET}>
                  <TypedChars text={HEADLINE_B} last />
                </span>
                <FootnoteRef n={2} />
              </span>
            </HeroHeadline>

            <div className="flex flex-1 flex-col justify-end gap-10 pt-14 pb-12 sm:pb-16 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
              <ol aria-label="Sources" className="grid max-w-3xl gap-6 text-sm sm:grid-cols-2 sm:gap-10">
                {HERO_FOOTNOTES.map((f, i) => (
                  <li
                    key={f.id}
                    id={f.id}
                    className="target:ring-foreground/25 -m-2 flex scroll-mt-24 gap-3 rounded-md p-2 leading-relaxed target:ring-1"
                  >
                    <span className="text-foreground font-medium tabular-nums">{i + 1}</span>
                    <p className="text-muted-foreground text-pretty">
                      {f.text}{" "}
                      <a href={f.link.href} className={textLink}>
                        {f.link.label}
                      </a>
                    </p>
                  </li>
                ))}
              </ol>
              <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3">
                <Link
                  href="/sign-up"
                  className={buttonVariants({ size: "lg", className: "h-11 px-5 text-[15px]" })}
                >
                  Create a workspace
                </Link>
                <a href={REPO_URL} className={cn(textLink, "text-[15px]")}>
                  View the source on GitHub
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* The product, straight after the claims: the first picture on the page. */}
        <div className="pt-16 sm:pt-20">
          <div className={container}>
            <HeroLive />
            <div className="flex flex-col gap-4 border-t py-10 sm:flex-row sm:items-center sm:gap-10">
              <p className="text-muted-foreground shrink-0 text-sm">Built with</p>
              <ul className="flex flex-wrap gap-x-7 gap-y-2 text-[15px] font-medium tracking-tight">
                {STACK.map((s) => (
                  <li key={s} className="text-foreground/85">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* The problem, and what changes */}
        <section aria-labelledby="problem-heading" className="py-24 sm:py-32">
          <div className={container}>
            <h2
              id="problem-heading"
              data-reveal
              className="font-display max-w-4xl text-3xl leading-[1.15] font-normal tracking-[-0.015em] text-balance sm:text-[2.75rem]"
            >
              Most answers already exist in your help centre.{" "}
              <span className="text-muted-foreground">
                SupportPilot finds them, drafts the reply and shows its sources, so agents review instead of
                retyping.
              </span>
            </h2>
            <div data-reveal data-spotlight className="relative mt-14 overflow-hidden rounded-2xl border">
              <div className="bg-muted/50 text-muted-foreground hidden grid-cols-2 border-b text-sm font-medium md:grid">
                <p className="px-6 py-3">The usual way</p>
                <p className="border-l px-6 py-3">With SupportPilot</p>
              </div>
              <ul className="divide-y">
                {CONTRAST.map((row) => (
                  <li key={row.after} className="grid grid-cols-1 md:grid-cols-2">
                    <p className="text-muted-foreground px-6 pt-5 pb-2 md:py-6">
                      <span className="sr-only">The usual way: </span>
                      {row.before}
                    </p>
                    <p className="flex gap-3 px-6 pt-2 pb-5 md:border-l md:py-6">
                      <Check aria-hidden="true" className="mt-1 size-4 shrink-0" />
                      <span>
                        <span className="sr-only">With SupportPilot: </span>
                        {row.after}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          aria-labelledby="how-heading"
          className="scroll-mt-16 border-t py-24 sm:py-32"
        >
          <div className={container}>
            <div data-reveal className="mb-12 flex max-w-2xl flex-col gap-4">
              <h2 id="how-heading" className={h2}>
                From new ticket to approved reply
              </h2>
              <p className={lead}>
                Four stages, each visible on the ticket. The AI does the reading and the first draft; a person
                decides what the customer gets.
              </p>
            </div>
            <div data-reveal>
              <WorkflowTabs steps={WORKFLOW_STEPS} label="Stages of a ticket" />
            </div>
          </div>
        </section>

        {/* Guardrails */}
        <section
          id="guardrails"
          data-theme="dark"
          aria-labelledby="guardrails-heading"
          className="land-band text-foreground relative scroll-mt-16 overflow-clip py-24 sm:py-32"
        >
          <div aria-hidden="true" className="land-glow pointer-events-none absolute inset-0" />
          <div className={cn(container, "relative")}>
            <div data-reveal className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-end">
              <h2 id="guardrails-heading" className={h2}>
                Guardrails you can see on every draft
              </h2>
              <p className={lead}>
                The checks run before an agent opens the draft, and their results are shown on it. When the AI
                can&apos;t back a reply with your articles, it doesn&apos;t write one.
              </p>
            </div>
            <Guardrails />
          </div>
        </section>

        {/* Customers */}
        <section aria-labelledby="customers-heading" className="py-24 sm:py-32">
          <div className={cn(container, "grid grid-cols-1 items-center gap-14 lg:grid-cols-2 lg:gap-20")}>
            <div data-reveal className="order-2 lg:order-1">
              <CustomerSide />
            </div>
            <div data-reveal className="order-1 flex flex-col gap-6 lg:order-2">
              <h2 id="customers-heading" className={h2}>
                Customers just write in
              </h2>
              <p className={lead}>
                Each company gets its own support form. Customers follow the conversation and reply from a
                private link, with no account to create.
              </p>
              <ul className="flex flex-col gap-3">
                {[
                  "A public form at /p/your-company, with spam protection and rate limits",
                  "A private tracking link; only a hash of it is stored",
                  "Replies, status and history on one page, on a phone or a desktop",
                ].map((t) => (
                  <li key={t} className="flex gap-3">
                    <Check aria-hidden="true" className="mt-1 size-4 shrink-0" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* The team */}
        <section aria-labelledby="team-heading" className="bg-muted/40 border-y py-24 sm:py-32">
          <div className={container}>
            <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-20">
              <div data-reveal className="flex flex-col gap-6">
                <h2 id="team-heading" className={h2}>
                  Fast for the people answering
                </h2>
                <p className={lead}>
                  Keyboard first, with a command palette and shortcuts for the inbox. Pages keep themselves up
                  to date, and changes save the moment you make them.
                </p>
              </div>
              <div
                data-reveal
                data-spotlight
                className="land-dots bg-background relative rounded-2xl border px-4 py-10 sm:px-10 sm:py-14"
              >
                <PaletteScene />
              </div>
            </div>
            <ul className="mt-16 grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {TEAM_FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} data-reveal className="flex flex-col gap-2 border-t pt-5">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Icon aria-hidden="true" className="text-muted-foreground size-4" />
                    {title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Evaluation */}
        <section id="evaluation" aria-labelledby="evaluation-heading" className="scroll-mt-16 py-24 sm:py-32">
          <div className={cn(container, "flex flex-col gap-10")}>
            <div data-reveal className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-end">
              <h2 id="evaluation-heading" className={h2}>
                Measured, not assumed
              </h2>
              <p className={lead}>
                Each result comes with its 95% confidence interval and the number of items it was measured on,
                from runs against real Gemini models on a labelled test set.
              </p>
            </div>
            <div data-reveal>
              <EvalResults />
              <p className="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="bg-foreground/25 h-1.5 w-4 rounded-full" /> 95% range
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="bg-foreground h-3 w-0.5 rounded-full" /> Result
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="border-muted-foreground h-3 border-l border-dashed" />{" "}
                  Target
                </span>
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground max-w-measure text-sm leading-relaxed">
                {LANDING_METRICS_NOTE}
              </p>
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

        {/* Engineering */}
        <section aria-labelledby="engineering-heading" className="border-t py-24 sm:py-32">
          <div className={cn(container, "grid grid-cols-1 items-center gap-14 lg:grid-cols-2 lg:gap-20")}>
            <div data-reveal className="flex flex-col gap-6">
              <h2 id="engineering-heading" className={h2}>
                Built like production software
              </h2>
              <p className={lead}>
                Next.js 16, React 19 and TypeScript on PostgreSQL with pgvector. The app uses its own REST
                API, described with OpenAPI, so anything it does can be scripted.
              </p>
              <ul className="flex flex-col gap-3 text-sm">
                {ENGINEERING.map((t) => (
                  <li key={t} className="flex gap-3">
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <a href={API_SPEC_PATH} className={textLink}>
                  OpenAPI description
                </a>
                <a href={ARCHITECTURE_URL} className={textLink}>
                  Architecture
                </a>
                <a href={ASVS_URL} className={textLink}>
                  Security review
                </a>
              </p>
            </div>
            <figure data-reveal className="flex flex-col gap-3">
              <ApiSample />
              <figcaption className="text-muted-foreground text-sm">
                A real endpoint from the OpenAPI description: how a customer&apos;s request is created, as
                JSON, with curl and from TypeScript. The tracking link is returned once.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* Closing */}
        <section
          data-theme="dark"
          aria-labelledby="start-heading"
          className="land-band text-foreground relative overflow-clip py-28 sm:py-36"
        >
          <div aria-hidden="true" className="land-glow pointer-events-none absolute inset-0" />
          <HandoffMotif className="text-foreground/[0.12] pointer-events-none absolute top-1/2 -right-40 size-[44rem] -translate-y-1/2 sm:-right-24 lg:right-0" />
          <div className={cn(container, "relative flex flex-col items-start gap-8")}>
            <h2
              id="start-heading"
              data-reveal
              className="font-display max-w-3xl text-4xl leading-[1.05] font-normal tracking-[-0.02em] text-balance sm:text-6xl"
            >
              Put your help centre to work.
            </h2>
            <p data-reveal className={cn(lead, "max-w-xl")}>
              Create a workspace, upload a few Markdown or PDF articles, and send a request through your own
              support form. Without an API key, a built-in mock AI runs everything offline.
            </p>
            <div data-reveal className="flex flex-wrap gap-3">
              <Link
                href="/sign-up"
                className={buttonVariants({ size: "lg", className: "h-11 px-5 text-[15px]" })}
              >
                Create a workspace
              </Link>
              <Link
                href="/sign-in"
                className={buttonVariants({
                  size: "lg",
                  variant: "outline",
                  className: "border-foreground/20 h-11 bg-transparent px-5 text-[15px]",
                })}
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div
          className={cn(
            container,
            "grid grid-cols-1 gap-10 py-12 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto] md:gap-16",
          )}
        >
          <div className="flex flex-col items-start gap-3">
            <Logo />
            <p className="text-muted-foreground max-w-sm">
              A portfolio project by{" "}
              <a href="https://github.com/HamayunKhan800" className={textLink}>
                Hamayun Khan
              </a>
              . Open source under the MIT licence.
            </p>
            <ThemeToggle initial={theme} />
          </div>
          <nav aria-label="Product">
            <p className="mb-2 font-medium">Product</p>
            <ul className="-mx-2.5 flex flex-col gap-0.5">
              {FOOTER_PRODUCT.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className={cn(navLink, "inline-flex min-h-8 items-center")}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Project">
            <p className="mb-2 font-medium">Project</p>
            <ul className="-mx-2.5 flex flex-col gap-0.5">
              {FOOTER_PROJECT.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className={cn(navLink, "inline-flex min-h-8 items-center")}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </footer>
    </>
  );
}
