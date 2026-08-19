// FRED macro data — daily, plus after expected releases. Only fetches
// series marked verified:true in fred-series.ts; unverified series stay
// untouched (and therefore unavailable in scoring) until confirmed.
import { NextRequest, NextResponse } from "next/server";
import * as fred from "@/services/market-data/fred";
import { FRED_SERIES, FredIndicatorKey } from "@/services/market-data/fred-series";
import { upsertEconomicIndicator } from "@/db/queries/market-data";
import { recordProviderCheck, setMarketsCovered } from "@/db/queries/provider-health";
import { demoModeSkip, isDemoMode, unauthorized, verifyCronAuth } from "../_shared";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  let okCount = 0;
  let failCount = 0;
  const countriesCovered = new Set<string>();

  for (const [country, indicators] of Object.entries(FRED_SERIES)) {
    for (const [indicatorKey, meta] of Object.entries(indicators) as [FredIndicatorKey, { id: string; verified: boolean }][]) {
      if (!meta.verified) continue;
      const t0 = Date.now();
      try {
        const result = await fred.getSeries(country, indicatorKey, 36);
        if (result.status !== "live" || !result.value) throw new Error(result.error ?? "series unavailable");
        for (const point of result.value) {
          await upsertEconomicIndicator(country, indicatorKey, meta.id, point.date, point.value);
        }
        okCount++;
        countriesCovered.add(country);
        // Keyed per country+indicator (e.g. "fred:GB:gdpGrowth") so the
        // GBPUSD validation page can show each required macro series
        // independently instead of one blanket "fred" row.
        await recordProviderCheck({ provider: `fred:${country}:${indicatorKey}`, ok: true, latencyMs: Date.now() - t0 }).catch(() => {});
      } catch (err) {
        failCount++;
        await recordProviderCheck({
          provider: `fred:${country}:${indicatorKey}`,
          ok: false,
          latencyMs: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        }).catch(() => {});
      }
    }
  }

  await setMarketsCovered("fred", countriesCovered.size).catch(() => {});
  return NextResponse.json({ job: "macro", okCount, failCount, countriesCovered: countriesCovered.size });
}
