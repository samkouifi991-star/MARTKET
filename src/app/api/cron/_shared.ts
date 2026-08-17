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

type JobResult = { symbol?: string; ok: boolean; error?: string };

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
      results.push({ symbol, ok: true });
      await recordProviderCheck({ provider, ok: true, latencyMs: Date.now() - t0 }).catch(() => {});
    } catch (err) {
      results.push({ symbol, ok: false, error: err instanceof Error ? err.message : String(err) });
      await recordProviderCheck({ provider, ok: false, latencyMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  await setMarketsCovered(provider, okCount).catch(() => {});
  return { results, okCount, failCount: results.length - okCount };
}
