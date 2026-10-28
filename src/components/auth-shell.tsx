import { Logo } from "@/components/logo";
import { HeroField } from "@/components/marketing/landing/hero-field";
import { REPO_URL } from "@/lib/landing";

/**
 * Layout for sign-in, sign-up, invitations and workspace setup (design step 10.3). One narrow,
 * centred column, as on Linear, Vercel, Resend, Plain, Attio and Clerk: none of them puts a demo
 * beside the form. The form sits on a frosted card over a quiet version of the landing page's dot
 * field, so the page still feels like the same product. On a phone the card frame is dropped and
 * the form starts near the top, using the full width.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-svh flex-1 flex-col overflow-hidden">
      <HeroField quiet className="auth-backdrop" />
      <header className="relative px-5 py-5 sm:px-8">
        <Logo />
      </header>
      <main id="main" className="relative flex flex-1 justify-center px-5 pt-6 pb-10 sm:items-center sm:pt-0">
        <div className="sm:glass w-full max-w-sm sm:max-w-[26rem] sm:rounded-2xl sm:border sm:p-9 sm:shadow-[0_24px_60px_-28px_rgb(0_0_0/0.35)]">
          {children}
        </div>
      </main>
      <footer className="text-muted-foreground relative px-5 pb-5 text-center text-xs">
        A portfolio project.{" "}
        <a href={REPO_URL} className="hover:text-foreground underline underline-offset-4">
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}
