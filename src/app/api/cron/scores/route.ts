// Total market scores — recalculated whenever an underlying factor changes;
// this cron job is the periodic fallback that guarantees every market's
// score history stays current even if nothing else triggered a recompute.
// computeLiveMarketScore already persists to factor_scores/market_scores
// internally (see lib/pipeline/scoring-engine.ts), so this route is a thin
// "run it for every symbol" loop.
import { NextRequest, NextResponse } from "next/server";
import { INSTRUMENTS } from "@/lib/instruments";
import { computeLiveMarketScore } from "@/lib/pipeline/scoring-engine";
import { DATA_MODE } from "@/services/data-mode";
import { demoModeSkip, isDemoMode, unauthorized, verifyCronAuth } from "../_shared";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  let okCount = 0;
  let failCount = 0;
  const failures: { symbol: string; error: string }[] = [];

  for (const instrument of INSTRUMENTS) {
    try {
      await computeLiveMarketScore(instrument.symbol, DATA_MODE);
      okCount++;
    } catch (err) {
      failCount++;
      failures.push({ symbol: instrument.symbol, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ job: "scores", okCount, failCount, failures });
}
