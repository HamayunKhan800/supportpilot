import { getDb } from "../db/client";
import { getEnv } from "../env";
import { type Auth, createAuth } from "./auth";

// Created lazily so `next build` never needs runtime secrets; reused across hot reloads.
const globalForAuth = globalThis as unknown as { __spAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__spAuth ??= createAuth(getDb().db, getEnv());
  return globalForAuth.__spAuth;
}

export type { Auth } from "./auth";
