import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { parseThemePreference, THEME_COOKIE, themeAttribute } from "@/lib/theme";
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
  // The saved theme is applied on the server: no pre-paint script, no flash (src/lib/theme.ts).
  const theme = themeAttribute(parseThemePreference((await cookies()).get(THEME_COOKIE)?.value));
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="focus:bg-background focus:text-foreground focus:outline-ring sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:px-4 focus:py-2 focus:outline focus:outline-2"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
