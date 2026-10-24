import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-1 flex-col px-6 py-6">
      <Logo className="self-start" />
      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-4 py-16">
        <p className="text-muted-foreground font-mono text-sm">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist, has moved, or the link has expired.
        </p>
        <Link
          href="/"
          className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 self-start px-4" })}
        >
          Go home
        </Link>
      </main>
    </div>
  );
}
