"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The landing page's menu on phones (design step 11). Measured on Vercel, Resend, Attio and
 * Plain: the header holds only the logo and a menu button; the menu opens full screen under the
 * header, links as large rows, then the two calls to action as full-width buttons.
 *
 * Behaves like a modal while open: the page behind does not scroll, Tab stays inside (the
 * button that closes it plus the menu), Escape closes it and gives focus back to the button,
 * and choosing a link closes it. It also closes if the screen grows past the phone layout.
 */
export function MobileMenu({ links }: { links: readonly { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    root.toggleAttribute("data-menu-open", true); // the header turns solid (globals.css)
    panel.current?.querySelector<HTMLElement>("a")?.focus();

    const close = (refocus: boolean) => {
      setOpen(false);
      if (refocus) button.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key !== "Tab" || !panel.current || !button.current) return;
      const stops = [button.current, ...panel.current.querySelectorAll<HTMLElement>("a,button")];
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const wide = window.matchMedia("(min-width: 48rem)");
    const onWide = () => wide.matches && close(false);
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      root.style.overflow = before;
      root.removeAttribute("data-menu-open");
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={button}
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="text-foreground hover:bg-accent focus-visible:ring-ring -mr-2.5 inline-flex size-11 items-center justify-center rounded-md outline-none focus-visible:ring-2"
      >
        {/* Two thin 18 px lines 8 px apart in a 44 px target (Vercel: 16 px, Intercom: 18 px, Plain:
            20 px; measured 2026-10-25); a cross while the menu is open. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M3 8h18M3 16h18" />}
        </svg>
      </button>
      {/* Rendered at the top of the page: the header's backdrop blur would otherwise make it the
          containing block of this fixed panel. Same dark ink as the header. */}
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            data-theme="dark"
            className="menu-in text-foreground fixed inset-x-0 top-16 bottom-0 z-40 flex flex-col overflow-y-auto bg-[var(--band-bg)] px-5 pt-2 pb-8"
          >
            <nav aria-label="Main" className="flex flex-col">
              <ul className="flex flex-col">
                {links.map((l) => (
                  <li key={l.href} className="border-b">
                    <a
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className="focus-visible:ring-ring flex h-14 items-center rounded-sm text-lg font-medium tracking-tight outline-none focus-visible:ring-2"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col gap-3">
                <Link
                  href="/sign-up"
                  onClick={() => setOpen(false)}
                  className={cn(buttonVariants({ size: "lg" }), "h-11 text-base")}
                >
                  Sign up
                </Link>
                <Link
                  href="/sign-in"
                  onClick={() => setOpen(false)}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg", className: "h-11 text-base" }),
                  )}
                >
                  Sign in
                </Link>
              </div>
            </nav>
          </div>,
          document.body,
        )}
    </div>
  );
}
