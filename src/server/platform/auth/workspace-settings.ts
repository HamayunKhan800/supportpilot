import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { workspaceSettings } from "../db/schema";

/** Default triage categories for a new workspace (editable in a later milestone). */
export const DEFAULT_CATEGORIES = ["billing", "bug", "account", "how-to", "feature-request", "other"];

export async function createDefaultWorkspaceSettings(db: Database, workspaceId: string): Promise<void> {
  await db
    .insert(workspaceSettings)
    .values({ workspaceId, categories: DEFAULT_CATEGORIES })
    .onConflictDoNothing({ target: workspaceSettings.workspaceId });
}

export async function getWorkspaceSettings(db: Database, workspaceId: string) {
  const [row] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  return row ?? null;
}
