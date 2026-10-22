"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-wrap gap-1">
      {links.map((l) => {
        const exact = pathname === l.href;
        // Sections stay highlighted on their sub-pages (e.g. a ticket under Tickets).
        const active = exact || (l.href !== "/app" && pathname.startsWith(`${l.href}/`));
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={exact ? "page" : active ? "true" : undefined}
              className={cn(
                "hover:bg-muted inline-flex h-9 items-center rounded-md px-3 text-sm",
                active && "bg-muted font-medium",
              )}
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
