// Shared "recompute V2 shadow scores for exactly the markets a release/
// news event actually touched" policy — extracted from
// app/api/watch/economic-releases/route.ts's original inline loop so the
// Zapier webhook (app/api/integrations/zapier/market-event/route.ts) can
// reuse the EXACT same targeted-recompute behavior instead of drifting
// into a subtly different one. Writes only to Scoring Engine V2's shadow
// tables (computeMarketScoreV2's storageOnly+persist option) — no V1
// table, route, or score is ever touched here.
import { affectedMarketsFor } from "@/services/economic-calendar/affected-markets";
import { computeMarketScoreV2 } from "./engine";
import { DATA_MODE, strictLiveSymbolList } from "@/services/data-mode";

/** Recomputes V2 shadow scores for exactly the strict-live markets
 * affectedMarketsFor(country) names, for each of the given countries —
 * never every strict-live market just because SOMETHING happened. */
export async function recomputeAffectedMarketsForCountries(countries: string[]): Promise<string[]> {
  const liveSymbols = new Set(strictLiveSymbolList());
  const symbols = new Set<string>();
  for (const country of new Set(countries)) {
    for (const symbol of affectedMarketsFor(country)) {
      if (liveSymbols.has(symbol)) symbols.add(symbol);
    }
  }
  return recomputeSymbols(Array.from(symbols));
}

/** Same targeted-recompute policy for a caller (news classification) that
 * already has an explicit symbol list rather than a country list. */
export async function recomputeSymbols(symbols: string[]): Promise<string[]> {
  const liveSymbols = new Set(strictLiveSymbolList());
  const targets = symbols.filter((s) => liveSymbols.has(s));
  const results = await Promise.allSettled(targets.map((s) => computeMarketScoreV2(s, DATA_MODE, { storageOnly: true, persist: true })));
  return targets.filter((_, i) => results[i].status === "fulfilled");
}
