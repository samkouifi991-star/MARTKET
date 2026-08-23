import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/market-data/last-known-good");

import { getFredSeriesWithFallback } from "@/services/market-data/last-known-good";
import { FredIndicatorKey } from "@/services/market-data/fred-series";
import { Provenance, FredSeriesPoint } from "@/services/types";
import { computeGoldMacroRegime, resolveGoldInflationFactor, resolveGoldInterestRatesFactor } from "./gold-macro";

// Only DFII10 (realYield10y), DTWEXBGS (usdIndexBroad), DGS2 (yield2y),
// VIXCLS (vix), and T10YIE (breakevenInflation10y) matter here — a two-point
// series is enough for change() to compute oldest-vs-newest, matching the
// real getFredSeriesWithFallback contract (oldest-first, per fred.ts).
function series(from: number, to: number, status: Provenance<FredSeriesPoint[]>["status"] = "live"): Provenance<FredSeriesPoint[]> {
  return {
    provider: "fred",
    source: "FRED",
    status,
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    nextExpectedUpdate: null,
    value: [
      { date: "2024-01-01", value: from },
      { date: "2024-03-01", value: to },
    ],
  };
}

function unavailable(): Provenance<FredSeriesPoint[]> {
  return { provider: "fred", source: "FRED", status: "unavailable", fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
}

type MockSeries = Partial<Record<FredIndicatorKey, Provenance<FredSeriesPoint[]>>>;

function mockSeries(map: MockSeries) {
  vi.mocked(getFredSeriesWithFallback).mockImplementation(async (_country: string, indicator: FredIndicatorKey) => map[indicator] ?? unavailable());
}

describe("computeGoldMacroRegime", () => {
  beforeEach(() => vi.resetAllMocks());

  it("scores a rising real yield as bearish (negative interestRatesRaw)", async () => {
    mockSeries({ realYield10y: series(1.5, 2.5) }); // +1.0pt rise
    const regime = await computeGoldMacroRegime();
    expect(regime.interestRatesRaw).toBeLessThan(0);
    expect(regime.interestRatesFreshness).toBe("live");
  });

  it("scores a falling real yield as bullish (positive interestRatesRaw) — the mirror image of the rising case", async () => {
    mockSeries({ realYield10y: series(2.5, 1.5) }); // -1.0pt fall
    const regime = await computeGoldMacroRegime();
    expect(regime.interestRatesRaw).toBeGreaterThan(0);
  });

  it("scores a strengthening dollar as bearish and a weakening dollar as bullish", async () => {
    mockSeries({ usdIndexBroad: series(100, 105) }); // strengthened
    const strong = await computeGoldMacroRegime();
    expect(strong.interestRatesRaw).toBeLessThan(0);

    mockSeries({ usdIndexBroad: series(105, 100) }); // weakened
    const weak = await computeGoldMacroRegime();
    expect(weak.interestRatesRaw).toBeGreaterThan(0);
  });

  it("treats a falling 2Y yield (rising Fed-cut expectations) as bullish", async () => {
    mockSeries({ yield2y: series(4.5, 3.5) }); // 2Y yield fell -> more cuts priced in
    const regime = await computeGoldMacroRegime();
    expect(regime.interestRatesRaw).toBeGreaterThan(0);
    expect(regime.interestRatesExplanation).toMatch(/Fed easing/);
  });

  it("treats rising VIX (increasing risk-off conditions) as moderately bullish", async () => {
    mockSeries({ vix: series(15, 25) }); // VIX spiked
    const regime = await computeGoldMacroRegime();
    expect(regime.interestRatesRaw).toBeGreaterThan(0);
  });

  it("compounds all four rate-side drivers into one clamped, dominantly-bearish composite when every driver is bearish", async () => {
    mockSeries({
      realYield10y: series(0, 2), // sharp real-yield spike -> strongly bearish
      usdIndexBroad: series(95, 110), // sharp dollar rally -> bearish
      yield2y: series(3.5, 5.5), // hawkish repricing -> bearish
      vix: series(25, 12), // risk-off easing -> a mild headwind
    });
    const regime = await computeGoldMacroRegime();
    expect(regime.interestRatesRaw).toBe(-10); // clamped at the shared -10..10 floor
  });

  it("treats rising breakeven inflation as bullish for the inflation factor", async () => {
    mockSeries({ breakevenInflation10y: series(2.0, 2.5) });
    const regime = await computeGoldMacroRegime();
    expect(regime.inflationRaw).toBeGreaterThan(0);
    expect(regime.inflationFreshness).toBe("live");
  });

  it("dampens (but does not zero) the inflation-hedge bid when real yields rose over the same window — not simply offsetting it 1:1", async () => {
    mockSeries({ breakevenInflation10y: series(2.0, 2.5), realYield10y: series(1.0, 1.1) }); // real yield up only slightly
    const dampened = await computeGoldMacroRegime();

    mockSeries({ breakevenInflation10y: series(2.0, 2.5), realYield10y: series(1.0, 0.9) }); // real yield down instead
    const undampened = await computeGoldMacroRegime();

    expect(dampened.inflationRaw).toBeGreaterThan(0); // still bullish, not zeroed
    expect(dampened.inflationRaw).toBeLessThan(undampened.inflationRaw); // but weaker than the un-offset case
    expect(dampened.inflationExplanation).toMatch(/partially offset by rising real yields/);
  });

  it("reports unavailable, not a fabricated zero-is-neutral read, when no rate-side series resolve at all", async () => {
    mockSeries({});
    const regime = await computeGoldMacroRegime();
    expect(regime.interestRatesFreshness).toBe("unavailable");
    expect(regime.inflationFreshness).toBe("unavailable");
    expect(regime.interestRatesRaw).toBe(0);
    expect(regime.inflationRaw).toBe(0);
  });
});

describe("resolveGoldInterestRatesFactor / resolveGoldInflationFactor", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns a real ResolvedFactor keyed correctly when the composite resolves", async () => {
    mockSeries({ realYield10y: series(2.0, 1.0) }); // falling real yield -> bullish
    const factor = await resolveGoldInterestRatesFactor("live");
    expect(factor.key).toBe("interestRates");
    expect(factor.provider).toBe("fred");
    expect(factor.rawScore).toBeGreaterThan(0);
    expect(factor.freshness).toBe("live");
  });

  it("stays unavailable — never falls back to demo data — when live mode has no resolvable series, since XAUUSD is a strict-live symbol", async () => {
    mockSeries({});
    const factor = await resolveGoldInterestRatesFactor("live");
    expect(factor.freshness).toBe("unavailable");
    expect(factor.provider).toBe("none");
  });

  it("still refuses demo fallback in hybrid mode for XAUUSD specifically — strict-live symbols never silently substitute demo data", async () => {
    mockSeries({});
    const factor = await resolveGoldInflationFactor("hybrid");
    expect(factor.freshness).toBe("unavailable");
    expect(factor.provider).toBe("none");
  });
});
