import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./forex-scorecard", () => ({ buildAllForexScorecards: vi.fn() }));
vi.mock("./economic-heatmap", () => ({ buildEconomicHeatmap: vi.fn() }));
vi.mock("./geopolitical-risk", () => ({ buildGeopoliticalRisk: vi.fn() }));
vi.mock("@/db/queries/economic-releases", () => ({ getRecentSurprisesForCountries: vi.fn() }));

import { buildAllForexScorecards } from "./forex-scorecard";
import { buildEconomicHeatmap } from "./economic-heatmap";
import { buildGeopoliticalRisk } from "./geopolitical-risk";
import { getRecentSurprisesForCountries } from "@/db/queries/economic-releases";
import { getLandingFeaturePreviews } from "./landing-previews";
import type { MarketRow } from "@/lib/market-data";

function row(symbol: string, institutionalContribution: number): MarketRow {
  return {
    instrument: { symbol, name: symbol, assetClass: "Forex", decimals: 4 },
    score: {
      symbol,
      totalScore: 0,
      bias: "Neutral",
      confidence: 50,
      change24h: 0,
      factors: [{ key: "institutional", contribution: institutionalContribution, rawScore: 0, weight: 0.2, explanation: "", source: "", freshness: "live", lastUpdated: "", nextUpdate: "" }],
      history: [],
      lastUpdated: "",
    },
    price: { symbol, current: 1, changePct24h: 0, series: [], ema20: 0, sma50: 0, sma100: 0, sma200: 0, rsi14: 0, adx14: 0, roc10: 0, structure: "Choppy / Mixed" },
  } as unknown as MarketRow;
}

describe("getLandingFeaturePreviews", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(buildAllForexScorecards).mockResolvedValue([]);
    vi.mocked(buildEconomicHeatmap).mockResolvedValue({ currencies: [], rows: [] });
    vi.mocked(getRecentSurprisesForCountries).mockResolvedValue([]);
    vi.mocked(buildGeopoliticalRisk).mockResolvedValue({ level: "LOW", score: 0, subScores: { safeHaven: 0, energy: 0, tradeTariff: 0, monetaryPolicy: 0 }, events: [] });
  });

  it("ranks institutional movers by absolute contribution, filtering out zero", async () => {
    const rows = [row("EURUSD", 0), row("GBPJPY", -2), row("USDJPY", 1)];
    const previews = await getLandingFeaturePreviews(rows);
    expect(previews.institutional!.map((r) => r.symbol)).toEqual(["GBPJPY", "USDJPY"]);
  });

  it("degrades a single panel to null on error without throwing", async () => {
    vi.mocked(buildAllForexScorecards).mockRejectedValue(new Error("db down"));
    const previews = await getLandingFeaturePreviews([]);
    expect(previews.forexScorecard).toBeNull();
    expect(previews.economicHeatmap).not.toBeNull();
  });
});
