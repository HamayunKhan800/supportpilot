import { Logo } from "@/components/logo";
import { ProductPreview } from "@/components/marketing/product-preview";
import { REPO_URL } from "@/lib/landing";

/**
 * Split layout for sign-in, sign-up, invitations and workspace setup (design system step 5):
 * the form on the left; on wide screens a quiet panel on the right with a small picture of
 * the product and one sentence about it (no testimonials or logos: there are none to show).
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main id="main" className="flex min-w-0 flex-col px-6 py-6 sm:px-10">
        <Logo className="self-start" />
        <div className="flex flex-1 items-center justify-center py-10">
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
        className="bg-muted/40 hidden min-w-0 flex-col justify-center gap-8 border-l px-12 py-16 lg:flex xl:px-20"
      >
        <div className="flex max-w-lg flex-col gap-3">
          <p className="text-muted-foreground font-mono text-xs font-medium tracking-wider uppercase">
            Human in the loop
          </p>
          <p className="text-2xl font-semibold tracking-tight text-balance">
            Every AI reply cites its sources and waits for a person&apos;s approval.
          </p>
        </div>
        <figure className="max-w-lg">
          <ProductPreview compact />
          <figcaption className="text-muted-foreground mt-3 text-sm">
            A draft from the demo workspace, with the checks an agent sees before sending.
          </figcaption>
        </figure>
      </aside>
    </div>
  );
}
