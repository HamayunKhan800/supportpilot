import { notFound } from "next/navigation";
import { AppError } from "@/server/platform/errors";

/** Loads review data; anything the service refuses (feature off, not a reviewer) is a 404. */
export async function loadOrNotFound<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof AppError && (err.status === 404 || err.status === 401)) notFound();
    throw err;
  }
}
