// FRED macro data — daily, plus after expected releases. Only fetches
// series marked verified:true in fred-series.ts; unverified series stay
// untouched (and therefore unavailable in scoring) until confirmed.
import { NextRequest, NextResponse } from "next/server";
import * as fred from "@/services/market-data/fred";
import { FRED_SERIES, FredIndicatorKey } from "@/services/market-data/fred-series";
import { upsertEconomicIndicator } from "@/db/queries/market-data";
import { recordProviderCheck, setMarketsCovered } from "@/db/queries/provider-health";
import { classifyIngestionError, dbWrite, demoModeSkip, isDemoMode, unauthorized, verifyCronOrEventWatchAuth } from "../_shared";

export async function GET(req: NextRequest) {
  if (!verifyCronOrEventWatchAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const t0 = Date.now();
  let okCount = 0;
  let failCount = 0;
  let rowsWritten = 0;
  const countriesCovered = new Set<string>();
  const results: { series: string; ok: boolean; error?: string; code: ReturnType<typeof classifyIngestionError>; rowCount: number }[] = [];

  for (const [country, indicators] of Object.entries(FRED_SERIES)) {
    for (const [indicatorKey, meta] of Object.entries(indicators) as [FredIndicatorKey, { id: string; verified: boolean }][]) {
      if (!meta.verified) continue;
      const series = `${country}:${indicatorKey}`;
      const rt0 = Date.now();
      try {
        const result = await fred.getSeries(country, indicatorKey, 36);
        // Store any real observation set (status "live", "delayed", or
        // "stale" — all carry genuine FRED data, just classified by
        // publication age; only "unavailable"/"error" have no value).
        // Rejecting delayed/stale here would silently drop real macro data
        // for slower-cadence indicators (quarterly GDP, lagging non-US
        // series) that are never going to read "live" under a tight window.
        if (!result.value) throw new Error(result.error ?? "series unavailable");
        for (const point of result.value) {
          await dbWrite(() => upsertEconomicIndicator(country, indicatorKey, meta.id, point.date, point.value));
        }
        okCount++;
        rowsWritten += result.value.length;
        countriesCovered.add(country);
        results.push({ series, ok: true, code: "SUCCESS", rowCount: result.value.length });
        // Keyed per country+indicator (e.g. "fred:GB:gdpGrowth") so the
        // GBPUSD validation page can show each required macro series
        // independently instead of one blanket "fred" row.
        await recordProviderCheck({ provider: `fred:${country}:${indicatorKey}`, ok: true, latencyMs: Date.now() - rt0 }).catch(() => {});
      } catch (err) {
        failCount++;
        const message = err instanceof Error ? err.message : String(err);
        results.push({ series, ok: false, error: message, code: classifyIngestionError(message), rowCount: 0 });
        await recordProviderCheck({
          provider: `fred:${country}:${indicatorKey}`,
          ok: false,
          latencyMs: Date.now() - rt0,
          error: message,
        }).catch(() => {});
      }
    }
  }

  await setMarketsCovered("fred", countriesCovered.size).catch(() => {});
  return NextResponse.json({
    job: "macro",
    okCount,
    failCount,
    countriesCovered: countriesCovered.size,
    durationMs: Date.now() - t0,
    rowsWritten,
    results,
  });
}
