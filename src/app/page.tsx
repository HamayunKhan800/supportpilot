import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
const milestones = [
  { id: "M0", label: "Requirements & design", done: true },
  { id: "M1", label: "Foundation: CI, database, health checks", done: true },
  { id: "M2", label: "Authentication & multi-tenancy", done: true },
  { id: "M3", label: "Ticketing: portal, inbox, REST API", done: true },
  { id: "M4", label: "Knowledge base ingestion", done: false },
  { id: "M5", label: "AI triage & grounded drafts", done: false },
];

export default function Home() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-wide text-zinc-600 uppercase dark:text-zinc-400">
          Work in progress
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">SupportPilot</h1>
        <p className="text-lg text-zinc-700 dark:text-zinc-300">
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
              className="flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
            >
              <span
                aria-hidden="true"
                className={m.done ? "text-green-700 dark:text-green-400" : "text-zinc-400 dark:text-zinc-500"}
              >
                {m.done ? "✓" : "○"}
              </span>
              <span className="font-mono text-sm text-zinc-600 dark:text-zinc-400">{m.id}</span>
              <span>{m.label}</span>
              <span className="sr-only">{m.done ? "(complete)" : "(not started)"}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
