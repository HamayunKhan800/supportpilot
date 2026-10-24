import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { NavigationProgress } from "@/components/navigation-progress";
import { parseThemePreference, THEME_COOKIE, themeAttribute } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  // Absolute URLs for the share image (src/app/opengraph-image.png); the public URL is already
  // required for auth, so the deployed site needs no extra setting.
  metadataBase: new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000"),
  title: { default: "SupportPilot", template: "%s · SupportPilot" },
  description:
    "AI support replies grounded in your help centre, with citations checked and a person approving every reply.",
  openGraph: { siteName: "SupportPilot", type: "website" },
  twitter: { card: "summary_large_image" },
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
        <NavigationProgress />
        {children}
      </body>
    </html>
  );
}
