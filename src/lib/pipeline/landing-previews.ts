// Compact real-data previews for the landing page's "More ways to see
// the market" tabbed section (Phase 13 of the platform redesign) — Forex
// Scorecard, Economic Heatmap, Economic Surprise, Institutional
// Positioning (COT), and Geopolitical Risk. Every panel reads the exact
// same pipeline functions the real authenticated pages use (Phases 4-8);
// nothing here is a separate demo/mock dataset. Each panel degrades
// independently on error so one provider hiccup never breaks the whole
// landing page — same principle as landing.ts's resolveSmartMoneySafely.
import { CCY_TO_COUNTRY } from "@/lib/scoring";
import { buildAllForexScorecards, ForexScorecardData } from "./forex-scorecard";
import { buildEconomicHeatmap, EconomicHeatmapData } from "./economic-heatmap";
import { buildGeopoliticalRisk, GeopoliticalRiskData } from "./geopolitical-risk";
import { getRecentSurprisesForCountries, RecentSurpriseRow } from "@/db/queries/economic-releases";
import { MarketRow } from "@/lib/market-data";

export type LandingFeaturePreviews = {
  forexScorecard: ForexScorecardData[] | null;
  economicHeatmap: EconomicHeatmapData | null;
  topSurprises: RecentSurpriseRow[] | null;
  institutional: { symbol: string; name: string; contribution: number }[] | null;
  geopoliticalRisk: GeopoliticalRiskData | null;
};

const TOP_N = 3;

/** rows is the same getCanonicalMarketRows() list the landing page's
 * Top Setups preview already fetched — no second market-data call, just
 * ranked by the institutional factor's own contribution to today's score. */
function topInstitutionalMovers(rows: MarketRow[]): { symbol: string; name: string; contribution: number }[] {
  return rows
    .map((r) => ({ symbol: r.instrument.symbol, name: r.instrument.name, contribution: r.score.factors.find((f) => f.key === "institutional")?.contribution ?? 0 }))
    .filter((r) => r.contribution !== 0)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, TOP_N);
}

export async function getLandingFeaturePreviews(rows: MarketRow[]): Promise<LandingFeaturePreviews> {
  const countries = Object.values(CCY_TO_COUNTRY);

  const [forexScorecard, economicHeatmap, topSurprises, geopoliticalRisk] = await Promise.all([
    buildAllForexScorecards(true).catch(() => null),
    buildEconomicHeatmap(true).catch(() => null),
    getRecentSurprisesForCountries(countries, 24 * 14)
      .then((all) => all.filter((r) => r.surpriseZ !== null).sort((a, b) => Math.abs(b.surpriseZ ?? 0) - Math.abs(a.surpriseZ ?? 0)).slice(0, TOP_N))
      .catch(() => null),
    buildGeopoliticalRisk().catch(() => null),
  ]);

  return {
    forexScorecard: forexScorecard ? [...forexScorecard].sort((a, b) => Math.abs(b.strengthDifferential ?? 0) - Math.abs(a.strengthDifferential ?? 0)).slice(0, TOP_N) : null,
    economicHeatmap,
    topSurprises,
    institutional: topInstitutionalMovers(rows),
    geopoliticalRisk,
  };
}
