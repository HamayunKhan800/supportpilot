import { getDb, type Database } from "./client";

/** A Drizzle transaction handle. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run a query: the pool-backed database or an open transaction. */
export type Executor = Database | Transaction;

export function transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return getDb().db.transaction(fn);
}
