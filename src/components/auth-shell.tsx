import { Logo } from "@/components/logo";
import { HeroLive } from "@/components/marketing/landing/hero-live";
import { REPO_URL } from "@/lib/landing";

/**
 * Split layout for sign-in, sign-up, invitations and workspace setup (design steps 5 and 9.4):
 * the form on the left; on wide screens the right half plays the landing page's live demo, a
 * working picture of the product (no testimonials or logos: there are none to show).
 * On a phone the form starts near the top, without a screen of empty space above it.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <main id="main" className="flex min-w-0 flex-col px-5 py-5 sm:px-10 sm:py-6">
        <Logo className="self-start" />
        <div className="flex flex-1 justify-center pt-10 pb-8 sm:items-center sm:py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-muted-foreground text-xs">
          A portfolio project.{" "}
          <a href={REPO_URL} className="hover:text-foreground underline underline-offset-4">
            Source on GitHub
          </a>
        </p>
      </main>
      <aside
        aria-label="About SupportPilot"
        data-theme="dark"
        className="land-band text-foreground hidden min-w-0 flex-col justify-center gap-8 border-l px-10 py-12 lg:flex xl:px-14"
      >
        <p className="max-w-lg text-2xl font-semibold tracking-tight text-balance">
          Every AI reply cites its sources and waits for a person&apos;s approval.
        </p>
        <HeroLive compact />
      </aside>
    </div>
  );
}
