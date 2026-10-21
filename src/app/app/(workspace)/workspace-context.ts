import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAppContext } from "@/server/modules/workspaces/service";

/**
 * One workspace resolution per request, shared by the layout and the page. Next.js
 * renders layouts and pages in parallel, so each must not resolve (and possibly
 * re-select) the active workspace on its own.
 */
const loadAppContext = cache(async () => getAppContext(await headers()));

export async function requireAppWorkspace() {
  const app = await loadAppContext();
  if (app.status === "signed-out") redirect("/sign-in?next=/app");
  if (app.status === "no-workspace") redirect("/app/onboarding");
  return app;
}
