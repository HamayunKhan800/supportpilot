"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { startNavigation } from "./navigation-progress";

/**
 * Next.js's router, except `push` and `replace` start the top progress bar first, so page
 * changes made from code (command palette, J/K, after a form) show the same feedback as links.
 */
export function useProgressRouter(): ReturnType<typeof useRouter> {
  const router = useRouter();
  return useMemo(
    () => ({
      ...router,
      push: (href, options) => {
        startNavigation(href);
        router.push(href, options);
      },
      replace: (href, options) => {
        startNavigation(href);
        router.replace(href, options);
      },
    }),
    [router],
  );
}
