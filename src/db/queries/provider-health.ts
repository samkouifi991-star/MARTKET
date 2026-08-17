// Provider health — the current-state table behind the Admin "provider
// health" screen (section 15 of the spec): status, last success/failure,
// markets covered, latency, requests today. Upserted on every provider call
// from the ingestion jobs (see src/app/api/cron/*). Best-effort by design —
// a health-tracking write failure must never break the underlying fetch.
import { eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { providerHealth } from "../schema";

export type ProviderCheckResult = {
  provider: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
};

export async function recordProviderCheck(check: ProviderCheckResult): Promise<void> {
  const db = getDb();
  const now = new Date();
  const existing = await db.select().from(providerHealth).where(eq(providerHealth.provider, check.provider)).limit(1);
  const dayReset = existing[0]?.requestsDayResetAt;
  const sameDay = dayReset && dayReset.toDateString() === now.toDateString();

  await db
    .insert(providerHealth)
    .values({
      provider: check.provider,
      status: check.ok ? "live" : "error",
      lastSuccessAt: check.ok ? now : (existing[0]?.lastSuccessAt ?? null),
      lastFailureAt: check.ok ? (existing[0]?.lastFailureAt ?? null) : now,
      lastError: check.ok ? (existing[0]?.lastError ?? null) : check.error ?? "unknown error",
      latencyMs: check.latencyMs,
      requestsToday: sameDay ? (existing[0]?.requestsToday ?? 0) + 1 : 1,
      requestsDayResetAt: sameDay ? (dayReset ?? now) : now,
      checkedAt: now,
    })
    .onConflictDoUpdate({
      target: providerHealth.provider,
      set: {
        status: check.ok ? "live" : "error",
        lastSuccessAt: check.ok ? now : sql`${providerHealth.lastSuccessAt}`,
        lastFailureAt: check.ok ? sql`${providerHealth.lastFailureAt}` : now,
        lastError: check.ok ? sql`${providerHealth.lastError}` : check.error ?? "unknown error",
        latencyMs: check.latencyMs,
        requestsToday: sameDay ? sql`${providerHealth.requestsToday} + 1` : 1,
        requestsDayResetAt: sameDay ? sql`${providerHealth.requestsDayResetAt}` : now,
        checkedAt: now,
      },
    });
}

export async function setMarketsCovered(provider: string, count: number): Promise<void> {
  const db = getDb();
  await db
    .insert(providerHealth)
    .values({ provider, status: "unavailable", marketsCovered: count, checkedAt: new Date() })
    .onConflictDoUpdate({ target: providerHealth.provider, set: { marketsCovered: count } });
}

export type ProviderHealthRow = {
  provider: string;
  status: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  marketsCovered: number;
  latencyMs: number | null;
  requestsToday: number;
  checkedAt: string;
};

export async function getProviderHealth(): Promise<ProviderHealthRow[]> {
  const db = getDb();
  const rows = await db.select().from(providerHealth);
  return rows.map((r) => ({
    provider: r.provider,
    status: r.status,
    lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: r.lastFailureAt?.toISOString() ?? null,
    lastError: r.lastError,
    marketsCovered: r.marketsCovered,
    latencyMs: r.latencyMs,
    requestsToday: r.requestsToday,
    checkedAt: r.checkedAt.toISOString(),
  }));
}
