"use client";

import {
  BookOpen,
  ChartColumn,
  CircleUser,
  ClipboardCheck,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  type LucideIcon,
  Monitor,
  Moon,
  ScrollText,
  SlidersHorizontal,
  Sun,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Kbd } from "@/components/ui/kbd";
import { authClient } from "@/lib/auth-client";
import type { NavIcon } from "@/lib/navigation";
import { isApplePlatform } from "@/lib/preferences-client";
import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

export const NAV_ICON: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  tickets: Inbox,
  knowledge: BookOpen,
  analytics: ChartColumn,
  evaluation: FlaskConical,
  members: Users,
  settings: SlidersHorizontal,
  audit: ScrollText,
  review: ClipboardCheck,
  account: CircleUser,
};

export const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "Device", Icon: Monitor },
];

/** Product mark: an original life-buoy glyph on the brand colour (no third-party logo). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-primary text-primary-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md",
        className,
      )}
    >
      <LifeBuoy className="size-4" strokeWidth={2.25} />
    </span>
  );
}

const noSubscribe = () => () => {};

/** The platform's modifier key. Renders "Ctrl" on the server, then ⌘ on Apple devices. */
export function ModKey() {
  const apple = useSyncExternalStore(noSubscribe, isApplePlatform, () => false);
  return apple ? (
    <Kbd>
      <span aria-hidden="true">⌘</span>
      <span className="sr-only">Command</span>
    </Kbd>
  ) : (
    <Kbd>Ctrl</Kbd>
  );
}

/** Ends the session, then leaves the app. Shared by the user menu and the command palette. */
export function useSignOut() {
  const router = useRouter();
  return async () => {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  };
}

export { initials } from "@/lib/initials";
