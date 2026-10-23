import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
const milestones = [
  { id: "M0", label: "Requirements & design", done: true },
  { id: "M1", label: "Foundation: CI, database, health checks", done: true },
  { id: "M2", label: "Authentication & multi-tenancy", done: true },
  { id: "M3", label: "Ticketing: portal, inbox, REST API", done: true },
  { id: "M4", label: "Knowledge base ingestion", done: true },
  { id: "M5", label: "AI triage & grounded drafts", done: true },
  { id: "M6", label: "AI evaluation & observability", done: false },
  { id: "M7", label: "Security review", done: false },
  { id: "M8", label: "Deployment", done: false },
  { id: "M9", label: "Portfolio packaging", done: false },
];

export default function Home() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">Work in progress</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">SupportPilot</h1>
        <p className="text-muted-foreground text-lg">
          AI-assisted customer support with grounded, cited answers and a human in the loop.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
            Create an account
          </Link>
          <Link href="/sign-in" className={buttonVariants({ size: "lg", variant: "outline" })}>
            Sign in
          </Link>
        </div>
      </header>
      <section aria-labelledby="progress-heading" className="flex flex-col gap-3">
        <h2 id="progress-heading" className="text-xl font-semibold">
          Build progress
        </h2>
        <ol className="flex flex-col gap-2">
          {milestones.map((m) => (
            <li
              key={m.id}
              className="border-border bg-card flex items-center gap-3 rounded-lg border px-4 py-3"
            >
              <span aria-hidden="true" className={m.done ? "text-success-strong" : "text-muted-foreground"}>
                {m.done ? "✓" : "○"}
              </span>
              <span className="text-muted-foreground font-mono text-sm">{m.id}</span>
              <span>{m.label}</span>
              <span className="sr-only">{m.done ? "(complete)" : "(not started)"}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
