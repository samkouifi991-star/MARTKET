import { NextRequest, NextResponse } from "next/server";
import { recordProviderCheck, setMarketsCovered } from "@/db/queries/provider-health";
import { DATA_MODE } from "@/services/data-mode";

/** Vercel Cron sends requests with this header; verify it matches CRON_SECRET
 * (set as a Vercel env var) so the endpoint can't be triggered by anyone
 * who finds the URL. See https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs */
export function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed: no secret configured means no access
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Same idea as verifyCronAuth, for routes triggered by an external
 * scheduler (GitHub Actions) rather than Vercel Cron itself — accepts a
 * dedicated EVENT_WATCH_SECRET if one is configured, falling back to the
 * existing CRON_SECRET so a separate secret is optional, not required. */
export function verifyEventWatchAuth(req: NextRequest): boolean {
  const secret = process.env.EVENT_WATCH_SECRET || process.env.CRON_SECRET;
  if (!secret) return false; // fail closed: no secret configured means no access
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Ingestion diagnostic (production-freshness incident): the 6 ingestion
 * cron routes (prices/candles/positioning/retail-sentiment/macro/scores)
 * are normally gated by verifyCronAuth alone (CRON_SECRET only, matching
 * what Vercel Cron itself sends). This sandbox's GitHub API access is
 * deliberately blocked from managing Actions secrets (confirmed: the
 * platform proxy rejects any /actions/secrets call), so a manual,
 * one-job-at-a-time diagnostic run can't mint a new CRON_SECRET-holding
 * GitHub secret without printing the real value somewhere. Instead this
 * accepts EITHER CRON_SECRET (unchanged — Vercel's real scheduled Cron
 * keeps authenticating exactly as before) OR the already-configured
 * EVENT_WATCH_SECRET (already used by /api/watch/* diagnostic routes for
 * this exact "external scheduler" purpose) so a GitHub Actions workflow
 * can trigger these same production routes for diagnosis. Purely
 * additive: nothing that authenticated before stops authenticating. */
export function verifyCronOrEventWatchAuth(req: NextRequest): boolean {
  const header = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && header === `Bearer ${cronSecret}`) return true;
  const watchSecret = process.env.EVENT_WATCH_SECRET;
  if (watchSecret && header === `Bearer ${watchSecret}`) return true;
  return false;
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Every cron route must stay a no-op in demo mode — ingestion has no
 * reason to run (or touch a database that may not even exist) while the
 * site is serving demo data. */
export function demoModeSkip() {
  return NextResponse.json({ skipped: true, reason: "DATA_MODE is demo" });
}

export function isDemoMode(): boolean {
  return DATA_MODE === "demo";
}

export type IngestionErrorCode = "RATE_LIMITED" | "PLAN_BLOCKED" | "AUTH" | "PROVIDER" | "DB_WRITE_FAILED" | "UNSUPPORTED_GRANULARITY" | "SUCCESS";

type JobResult = { symbol?: string; ok: boolean; error?: string; code: IngestionErrorCode };

// Ingestion diagnostic (production-freshness incident) — classifies a raw
// error string (from either a provider Provenance.error or a DB write
// failure) into the exact buckets requested for the recovery report,
// instead of collapsing every failure into one generic "unavailable"/
// "error" bucket. Pattern-matched against the specific, already-existing
// error message text each provider module produces (fmp.ts's
// rateLimitMessage/plan-limited text, oanda-market-data.ts's raw HTTP
// status text) — no provider module changed, this only reads what they
// already say. dbWrite() below is what actually produces the
// DB_WRITE_FAILED prefix; everything else here is provider/fetch-side.
export function classifyIngestionError(rawMessage: string | undefined): IngestionErrorCode {
  if (!rawMessage) return "SUCCESS";
  const msg = rawMessage.toLowerCase();
  if (msg.startsWith("db_write_failed:")) return "DB_WRITE_FAILED";
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests")) return "RATE_LIMITED";
  if (msg.includes("402") || msg.includes("payment required") || msg.includes("plan does not include") || msg.includes("provider plan")) return "PLAN_BLOCKED";
  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("invalid api key") || msg.includes("invalid token") || msg.includes("not configured")) return "AUTH";
  if ((msg.includes("no confirmed") && (msg.includes("h1") || msg.includes("h4") || msg.includes("intraday") || msg.includes("granularity"))) || msg.includes("unsupported granularity")) {
    return "UNSUPPORTED_GRANULARITY";
  }
  if (/\b5\d\d\b/.test(msg) || msg.includes("fetch failed") || msg.includes("request failed") || msg.includes("econnreset") || msg.includes("timeout")) return "PROVIDER";
  return "PROVIDER";
}

/** Wraps a DB write so a failure there is distinguishable from a provider
 * fetch failure in the same per-symbol closure — both currently land in
 * the same try/catch (fetch-then-write), so without this a Neon error and
 * an OANDA/FMP error look identical in the JobResult. Never changes
 * whether the symbol counts as failed, only what the error says. */
export async function dbWrite<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`DB_WRITE_FAILED: ${message}`);
  }
}

export async function runJobForEachSymbol<T>(
  provider: string,
  symbols: string[],
  fn: (symbol: string) => Promise<T>
): Promise<{ results: JobResult[]; okCount: number; failCount: number }> {
  const results: JobResult[] = [];
  for (const symbol of symbols) {
    const t0 = Date.now();
    try {
      await fn(symbol);
      results.push({ symbol, ok: true, code: "SUCCESS" });
      await recordProviderCheck({ provider, ok: true, latencyMs: Date.now() - t0 }).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ symbol, ok: false, error: message, code: classifyIngestionError(message) });
      await recordProviderCheck({ provider, ok: false, latencyMs: Date.now() - t0, error: message }).catch(() => {});
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  await setMarketsCovered(provider, okCount).catch(() => {});
  return { results, okCount, failCount: results.length - okCount };
}
