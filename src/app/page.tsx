import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Logo, LogoMark } from "@/components/logo";
import {
  CitedHero,
  FooterName,
  SendSentence,
  StageSlider,
  Tally,
  type Stage,
} from "@/components/marketing/landing/cited";
import { LandingHeader } from "@/components/marketing/landing/landing-header";
import { MobileMenu } from "@/components/marketing/landing/mobile-menu";
import { Reveal } from "@/components/marketing/landing/reveal";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import {
  API_SPEC_PATH,
  ARCHITECTURE_URL,
  ASVS_URL,
  EVAL_REPORT_URL,
  LANDING_METRICS,
  LANDING_TALLY,
  REPO_URL,
} from "@/lib/landing";
import { parseThemePreference, THEME_COOKIE } from "@/lib/theme";
import { cn } from "@/lib/utils";
import "./landing.css";

export const metadata: Metadata = {
  title: { absolute: "SupportPilot · AI drafts, you approve" },
};

/*
 * The landing page, "The cited sentence" (docs/design/landing.md). The page is a few big
 * sentences; the product's citation number, its Approve & send button and its screens sit inside
 * them as words. Every claim is something the code does or a measured result with its sample
 * size; there are no customer logos, testimonials or invented numbers.
 */

const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#results", label: "Results" },
  { href: "#developers", label: "Developers" },
];

const FOOTER_LINKS = [
  { href: "#how", label: "How it works" },
  { href: EVAL_REPORT_URL, label: "Evaluation report" },
  { href: REPO_URL, label: "Source on GitHub" },
  { href: API_SPEC_PATH, label: "API description" },
  { href: ARCHITECTURE_URL, label: "Architecture" },
  { href: ASVS_URL, label: "Security review" },
  { href: "/sign-in", label: "Sign in" },
];

/** The safeguards, one statement per colour field. */
const FIELDS = [
  {
    title: "Every sentence cited.",
    body: "Each sentence in a draft links to the help-article passage it came from. Tap the number to read it, exactly as the model was given it.",
  },
  {
    title: "No answer, no draft.",
    body: "When no article answers the question, the AI says so and the ticket waits for a person. In our test it declined all 30 questions it could not answer.",
  },
  {
    title: "Checked first.",
    body: "Every draft is tested for real citations, known links and hidden instructions. All 20 prompt-injection attempts in our test were resisted.",
  },
  {
    title: "Fast from the keyboard.",
    body: "A approves, E edits, R regenerates. New tickets and drafts appear without a reload.",
  },
];

const Check = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/** One sample ticket (#128) through its four stages, drawn with the app's own parts and labels. */
const STAGES: Stage[] = [
  {
    name: "A ticket arrives",
    clause: "First, a ticket arrives",
    text: "A customer writes in through your help portal. No account needed, just a private link to follow the reply.",
    scene: (
      <div className="lp-card">
        <div className="hd">
          #128 Refund for my annual plan<span>9:26 AM</span>
        </div>
        <div className="bd">
          <div className="lp-who">Priya Shah · customer</div>
          <div className="lp-txt" data-customer="">
            My annual plan renewed 12 days ago and I didn&rsquo;t mean to keep it. Can I get my money back,
            and how long does it take?
          </div>
          <div className="lp-chips">
            <span className="lp-chip">
              <i data-open="" />
              Open
            </span>
            <span className="lp-chip">From the help portal</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    name: "Labelled",
    clause: "Then it is labelled",
    text: "Category, priority and language in about 1.3 seconds. Labels apply on their own only when the model is sure enough.",
    scene: (
      <div className="lp-card">
        <div className="hd">
          #128 Refund for my annual plan<span>Labelled in 1.3 s</span>
        </div>
        <div className="bd">
          <div className="lp-chips">
            <span className="lp-chip">
              <i />
              Category: billing
            </span>
            <span className="lp-chip">
              <i />
              Priority: normal
            </span>
            <span className="lp-chip">Language: English</span>
          </div>
          <div className="lp-txt">
            Confidence 97%, above your 95% threshold, so the labels were applied automatically.
          </div>
          <div className="lp-who">Below the threshold, labels wait as suggestions.</div>
        </div>
      </div>
    ),
  },
  {
    name: "Drafted, with sources",
    clause: "Then a cited draft",
    text: "Every sentence points at the passage it came from. When no article answers the question, there is no draft.",
    scene: (
      <div className="lp-card">
        <div className="hd">
          AI draft<span>Checked</span>
        </div>
        <div className="bd">
          <div className="lp-chips">
            <span className="lp-chip">
              <i />
              Cites 2 sources
            </span>
            <span className="lp-chip">
              <i />
              Every citation matches a source
            </span>
          </div>
          <div className="lp-txt">
            Hi Priya, yes. Annual plans can be refunded in full within 30 days of purchase or renewal, so your
            renewal qualifies <span className="lp-num">1</span>. To stop it renewing, go to Settings &gt;
            Billing and choose Cancel plan <span className="lp-num">2</span>.
          </div>
          <div className="lp-src">
            <span className="lp-num">1</span>Refund policy <span>› Annual plans</span>
          </div>
          <div className="lp-src">
            <span className="lp-num">2</span>Cancel your subscription
          </div>
          <div className="lp-btns" aria-hidden="true">
            <span className="lp-b" data-primary="">
              Approve &amp; send
            </span>
            <span className="lp-b">Edit</span>
            <span className="lp-b">Regenerate</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    name: "Approved and sent",
    clause: "Last, a person approves",
    text: "An agent reads, edits if needed and presses Approve & send. Only then does the customer get a reply.",
    scene: (
      <div className="lp-card">
        <div className="hd">
          #128 Refund for my annual plan<span>9:31 AM</span>
        </div>
        <div className="bd">
          <div className="lp-who">Ayesha · agent</div>
          <div className="lp-txt" data-customer="">
            Hi Priya, yes. Annual plans can be refunded in full within 30 days of purchase or renewal, so your
            renewal qualifies…
          </div>
          <div className="lp-sent">
            <Check />
            Approved by Ayesha and sent
          </div>
          <div className="lp-chips">
            <span className="lp-chip">Pending: waiting on the customer</span>
          </div>
        </div>
      </div>
    ),
  },
];

/** The evaluation page's summary card: short labels for LANDING_METRICS, in the same order. */
const EVAL_LABELS = [
  "Right article in the top five",
  "Right ticket category",
  "Citations to a given passage",
  "Unanswerable questions declined",
  "Answerable questions wrongly declined",
  "Prompt-injection attempts resisted",
];
const EVAL_ROWS = LANDING_METRICS.map((m, i) => [EVAL_LABELS[i] ?? m.label, m.result] as const);

export default async function Home() {
  const theme = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="lp flex flex-1 flex-col">
      <Reveal />
      <LandingHeader>
        <div className="flex h-16 items-center gap-8 px-[var(--lp-m)]">
          <Logo className="gap-2.5 text-lg [&_svg]:size-7" />
          <nav aria-label="Main" className="hidden flex-1 items-center gap-7 md:flex">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-muted-foreground hover:text-foreground text-base transition-colors"
              >
                {l.label}
              </a>
            ))}
            <Link
              href="/sign-in"
              className="text-muted-foreground hover:text-foreground ml-auto text-base transition-colors"
            >
              Sign in
            </Link>
            <Link href="/demo" className={buttonVariants({ className: "h-10 px-4 text-base" })}>
              Try the live demo
            </Link>
          </nav>
          <div className="ml-auto md:hidden">
            <MobileMenu links={NAV_LINKS} />
          </div>
        </div>
      </LandingHeader>

      <main id="main" className="flex-1 [&_:is(a,button,input)]:scroll-mt-20">
        <CitedHero
          passage={
            <>
              <div className="path">
                <span className="lp-num">1</span>Refund policy › Annual plans
              </div>
              <blockquote>
                Annual plans can be refunded in full within 30 days of purchase or renewal.
              </blockquote>
              <div className="foot">
                <span>Cited in the reply to ticket #128</span>
                <span>Help article</span>
              </div>
            </>
          }
        >
          <p className="lp-sub">
            Support replies drafted from your own help articles, with every sentence cited.
          </p>
          <div className="lp-act">
            <Link href="/demo" className={buttonVariants({ size: "lg", className: "h-12 px-6 text-base" })}>
              Try the live demo
            </Link>
            <Link href="/sign-up" className="lp-link">
              Create a workspace
            </Link>
          </div>
        </CitedHero>

        <StageSlider stages={STAGES} />

        <section aria-label="Safeguards">
          {FIELDS.map((f, n) => (
            <div key={f.title} className={`lp-field lp-f${n + 1}`} data-mirror={n % 2 ? "" : undefined}>
              <h2 data-reveal>{f.title}</h2>
              <p data-reveal>{f.body}</p>
            </div>
          ))}
        </section>

        <SendSentence />

        <section id="results" className="lp-ev" aria-labelledby="lp-results">
          <div className="copy" data-reveal>
            <h2 id="lp-results">Tested in public.</h2>
            <Tally>
              On real Gemini models in October 2026,{" "}
              {LANDING_TALLY.map((c, n) => (
                <span key={c.rest}>
                  <span className="k">
                    <b className={c.perfect ? "ok" : undefined}>{c.figure}</b> {c.rest}
                  </span>
                  {n === LANDING_TALLY.length - 1
                    ? "."
                    : n === LANDING_TALLY.length - 2
                      ? ". "
                      : n === 1
                        ? " and "
                        : ", "}
                </span>
              ))}
            </Tally>
            <div className="lp-act">
              <a href={EVAL_REPORT_URL} className="lp-link">
                Read the evaluation report
              </a>
            </div>
          </div>
          <figure className="proof" data-reveal>
            <div className="lp-evalcard lp-ui">
              <div className="t">
                Latest complete Gemini run <span>Complete</span>
              </div>
              <div className="when">Finished 24 October 2026 · 420 labelled test items</div>
              <div className="big">
                6 of 6<span>targets met</span>
              </div>
              <ol aria-label="Results">
                {EVAL_ROWS.map(([label, value]) => (
                  <li key={label}>
                    {label}
                    <b>{value}</b>
                  </li>
                ))}
              </ol>
              <div className="note">Targets are hypotheses to test, not promises.</div>
            </div>
            <figcaption className="lp-figcap">
              The summary on the app&rsquo;s evaluation page after the October run.
            </figcaption>
          </figure>
        </section>

        <section id="developers" className="lp-ev" data-mirror="" aria-labelledby="lp-dev">
          <div className="copy" data-reveal>
            <h2 id="lp-dev">Read every line.</h2>
            <p className="lp-state">
              Open source, with a typed public API, over 2,000 automated tests on every change, and a written
              OWASP security review.
            </p>
            <div className="lp-act">
              <a href={REPO_URL} className={buttonVariants({ size: "lg", className: "h-12 px-6 text-base" })}>
                View on GitHub
              </a>
              <a href={API_SPEC_PATH} className="lp-link">
                API description
              </a>
            </div>
          </div>
          <figure className="proof lp-code" aria-label="Creating a ticket through the public API" data-reveal>
            <div className="h">
              Create a ticket<span>POST</span>
            </div>
            <pre>
              <code>{"curl --json @ticket.json \\\n  $SITE/api/v1/portal/nimbus/tickets"}</code>
            </pre>
            <div className="h">
              201 Created<span>tracking link, returned once</span>
            </div>
            <pre>
              <code>{'{"trackingUrl": "https://…/t/9f2c…"}'}</code>
            </pre>
          </figure>
        </section>

        <section className="lp-cta" aria-labelledby="lp-cta-title">
          <h2 id="lp-cta-title" className="sr-only">
            Create a workspace
          </h2>
          <form action="/sign-up" method="get" data-reveal>
            <span>Bring your team:</span>
            <label htmlFor="lp-email" className="sr-only">
              Work email
            </label>
            <input id="lp-email" name="email" type="email" placeholder="Work email" autoComplete="email" />
            <button type="submit">Start</button>
          </form>
          <p>
            Opens sign-up with your email filled in. Free and open source, or{" "}
            <Link href="/demo">try the live demo</Link> first.
          </p>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-ft">
          <div className="inv">
            <h2>See a cited draft now.</h2>
            <Link
              href="/demo"
              className={cn(buttonVariants({ size: "lg" }), "lp-inv-btn h-12 px-6 text-base")}
            >
              Try the live demo
            </Link>
          </div>
          <ul aria-label="More">
            {FOOTER_LINKS.map((l) => (
              <li key={l.label}>
                <a href={l.href}>{l.label}</a>
              </li>
            ))}
          </ul>
        </div>
        <div className="lp-legal">
          <span className="cr">
            <LogoMark className="size-6 [&_svg]:size-5" />© 2026 SupportPilot. MIT licence. Made by Hamayun
            Khan.
          </span>
          <ThemeToggle initial={theme} />
        </div>
        <FooterName />
      </footer>
    </div>
  );
}
