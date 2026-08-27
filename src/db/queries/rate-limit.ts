// Auth rate-limit read/write queries (Phase 14 security audit) — backing
// lib/auth/actions.ts's signin/signup rate limiting. A real DB table, not
// an in-memory counter, since this app runs on serverless instances with
// no shared process memory across requests.
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "../client";
import { authAttempts } from "../schema";

export type AuthAction = "signin" | "signup" | "zapier_ingest";

// Prune anything older than the largest window any caller uses, on every
// write — keeps the table bounded without a separate cleanup cron. 24h
// comfortably covers both signin's and signup's windows (see actions.ts).
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Records one attempt and returns how many attempts from this identifier/
 * action have happened within `windowMs` (including the one just recorded)
 * — callers compare this against their own limit. */
export async function recordAuthAttempt(identifier: string, action: AuthAction, windowMs: number): Promise<number> {
  const db = getDb();
  await db.insert(authAttempts).values({ identifier, action });
  await db.delete(authAttempts).where(lt(authAttempts.attemptedAt, new Date(Date.now() - PRUNE_AFTER_MS)));

  const cutoff = new Date(Date.now() - windowMs);
  const rows = await db
    .select()
    .from(authAttempts)
    .where(and(eq(authAttempts.identifier, identifier), eq(authAttempts.action, action), gt(authAttempts.attemptedAt, cutoff)));
  return rows.length;
}
