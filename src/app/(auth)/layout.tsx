import Link from "next/link";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        SupportPilot
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
