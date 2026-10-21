import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SupportPilot", template: "%s · SupportPilot" },
  description: "AI-assisted customer support with grounded, cited answers and a human in the loop.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every page per request so Next.js can apply the CSP nonce (ADR-0011).
  await connection();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-black focus:outline focus:outline-2"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
