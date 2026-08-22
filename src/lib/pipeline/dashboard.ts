// Dashboard's own real-score data source — the same fix already applied to
// Top Setups (see top-setups.ts): the Dashboard previously rendered every
// score-driven stat (Markets Tracked, Very Bullish/Bearish, Avg.
// Confidence, Strongest bullish/bearish) via lib/market-data.ts's
// allMarketRows(), which ALWAYS used the demo score generator regardless of
// DATA_MODE and cached it at module scope for the serverless instance's
// lifetime — so it could show e.g. USDCHF +4.5 forever while
// /markets/USDCHF and /top-setups both moved on to the real, current score.
//
// The fix: read the exact same canonical current_market_score row those
// pages read (db/queries/scores.ts's getAllCurrentScores — one bulk read
// for every symbol, not 25 individual live computations). This is a pure
// Neon read: no live provider call (FMP/OANDA/CFTC/FRED/IG/Myfxbook) is
// ever triggered by loading or refreshing the Dashboard, and no fallback
// compute happens here either — a symbol with no current-score row yet is
// simply reported unavailable, so it can never leak a demo/estimated value
// into the bullish/bearish rankings or Avg. Confidence.
import { INSTRUMENTS } from "@/lib/instruments";
import { computeMarketScore } from "@/lib/scoring";
import { getAllCurrentScores } from "@/db/queries/scores";
import { isDemoOnly, isStrictLiveSymbol } from "@/services/data-mode";
import { Instrument, MarketScore } from "@/lib/types";

export type DashboardMarketRow = {
  instrument: Instrument;
  score: MarketScore | null;
  // Only a strict-live symbol is guaranteed to never carry a demo/estimated
  // factor anywhere in its canonical score (hybrid mode's demo-fallback
  // leniency is withheld for it — see data-mode.ts's allowsDemoFallback).
  // A non-strict-live symbol's current-score row can legitimately be built
  // from demo-fallback factors in hybrid mode, so it must never count
  // toward the Dashboard's bullish/bearish rankings, Very Bullish/Bearish
  // counts, or Avg. Confidence — those are "eligible" markets only.
  eligible: boolean;
};

export async function getDashboardMarketRows(): Promise<DashboardMarketRow[]> {
  if (isDemoOnly()) {
    return INSTRUMENTS.map((instrument) => ({ instrument, score: computeMarketScore(instrument), eligible: true }));
  }

  const scores = await getAllCurrentScores();
  return INSTRUMENTS.map((instrument) => {
    const score = scores.get(instrument.symbol) ?? null;
    return { instrument, score, eligible: score !== null && isStrictLiveSymbol(instrument.symbol) };
  });
}
