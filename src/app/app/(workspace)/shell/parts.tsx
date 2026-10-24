"use client";

import {
  BookOpen,
  ChartColumn,
  CircleUser,
  ClipboardCheck,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Monitor,
  Moon,
  ScrollText,
  SlidersHorizontal,
  Sun,
  Users,
} from "lucide-react";
import { useSyncExternalStore } from "react";
import { Kbd } from "@/components/ui/kbd";
import { authClient } from "@/lib/auth-client";
import type { NavIcon } from "@/lib/navigation";
import { isApplePlatform } from "@/lib/preferences-client";
import type { ThemePreference } from "@/lib/theme";
import { useProgressRouter } from "@/lib/use-progress-router";

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

export { LogoMark } from "@/components/logo";

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
  const router = useProgressRouter();
  return async () => {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  };
}

export { initials } from "@/lib/initials";
