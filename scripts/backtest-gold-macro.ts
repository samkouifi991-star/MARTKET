// Backtest: old (generic, growth-positive-is-bullish) Gold macro scoring vs.
// the new asset-specific goldMacroRegime composite (pipeline/gold-macro.ts),
// evaluated against real subsequent XAUUSD returns. Required before the new
// model is trusted to drive production scores (per spec: "run a backtest
// comparing old vs new Gold scoring over historical XAUUSD periods and
// report whether the new model better aligns with subsequent Gold returns").
//
// Reuses the ACTUAL production math wherever it exists, rather than
// reimplementing it, so this backtest can never silently drift from what the
// live pipeline computes:
//   - pipeline/gold-macro.ts's scoreGoldMacroRegime() — the exact new
//     inflation + interest-rates composite (real yields, USD, Fed-cut
//     expectations via 2Y yield, VIX, breakeven inflation).
//   - engines/macro-differential.ts's scoreIndicator() — the exact
//     z-scored growth/labor engine every other asset already uses; only the
//     final sign (asset-polarity.ts's growthLaborPolarity) differs between
//     old (+1, the bug) and new (-1, corrected for precious metals).
// The one piece with no reusable production function is the OLD inflation/
// interest-rates model for gold, since that model never existed as its own
// named function — it was just macro.ts's generic country-CPI/policy-rate-
// trend formula applied to gold with no gold-specific logic at all. That
// generic formula is reconstructed here explicitly (see oldInflationScore/
// oldInterestRatesScore below) directly from macro.ts's own committed
// pre-fix logic, not guessed.
//
// Needs FRED_API_KEY only (a single, free, self-serve credential — see
// https://fred.stlouisfed.org/docs/api/api_key.html) since gold's own price
// history is available directly from FRED as GOLDAMGBD228NLBM ("Gold Fixing
// Price 10:30 A.M. (London time) in London Bullion Market, based in U.S.
// Dollars") — a standard, long-established FRED series, used here for
// backtest validation only. Production price serving is unchanged: it still
// comes from FMP/OANDA via the canonical price pipeline, never from FRED.
//
// Usage:
//   FRED_API_KEY=xxx npm run backtest:gold-macro
// or place FRED_API_KEY in .env.local and just run: npm run backtest:gold-macro
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { scoreIndicator } from "../src/lib/engines/macro-differential";
import { scoreGoldMacroRegime, GoldMacroSeriesRead } from "../src/lib/pipeline/gold-macro";
import { FredSeriesPoint } from "../src/services/types";

const FRED_BASE = "https://api.stlouisfed.org/fred";

type RawObservations = { observations: { date: string; value: string }[] };

async function fetchSeries(seriesId: string, limit: number): Promise<FredSeriesPoint[]> {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new Error("FRED_API_KEY is not configured — set it in .env.local or the environment before running this script.");
  const url = new URL(`${FRED_BASE}/series/observations`);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("sort_order", "asc");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FRED request failed for ${seriesId}: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as RawObservations;
  return data.observations.filter((o) => o.value !== ".").map((o) => ({ date: o.date, value: Number(o.value) }));
}

// A trailing window of `count` observations at-or-before `asOfDate` — never
// including anything after it, so the backtest can't leak future data into
// a historical score (look-ahead bias).
function windowEndingAt(points: FredSeriesPoint[], asOfDate: string, count: number): FredSeriesPoint[] {
  const upTo = points.filter((p) => p.date <= asOfDate);
  return upTo.slice(-count);
}

function toSeriesRead(points: FredSeriesPoint[], minLength: number): GoldMacroSeriesRead {
  return points.length >= minLength ? { points, freshness: "live" } : { points: null, freshness: "unavailable" };
}

const GOLD_LOOKBACK = 60; // matches gold-macro.ts's LOOKBACK_OBSERVATIONS

// Reconstructed directly from macro.ts's pre-fix committed logic — the
// generic country-inflation-differential formula (CPI z-score * 0.45 weight)
// applied to gold with no gold-specific adjustment, and the generic
// interest-rates model (Fed-stance trend sign only, no real yield/USD/VIX).
// This is what production actually computed for XAUUSD's inflation and
// interestRates factors before this fix — not a new invention.
function oldInflationScore(cpiWindow: FredSeriesPoint[]): number | null {
  const score = scoreIndicator("cpi", cpiWindow);
  if (!score) return null;
  return Math.max(-10, Math.min(10, score.rawScore * 0.45));
}

function oldInterestRatesScore(fedFundsWindow: FredSeriesPoint[]): number | null {
  if (fedFundsWindow.length < 2) return null;
  const trend = Math.sign(fedFundsWindow[fedFundsWindow.length - 1].value - fedFundsWindow[0].value);
  return Math.max(-10, Math.min(10, -trend * 0.9 * 5)); // scale=0.9 (commodities), same as macro.ts's resolveInterestRatesFactor
}

function growthLaborScore(gdpWindow: FredSeriesPoint[], unrateWindow: FredSeriesPoint[], polarity: 1 | -1): number | null {
  const growth = scoreIndicator("realGdp", gdpWindow);
  const labor = scoreIndicator("unemploymentRate", unrateWindow);
  const parts = [growth?.rawScore, labor?.rawScore].filter((v): v is number => v !== undefined);
  if (parts.length === 0) return null;
  const avg = parts.reduce((s, v) => s + v, 0) / parts.length;
  return Math.max(-10, Math.min(10, avg * 0.45 * polarity)); // weight=0.45, same as macro.ts's commodity weight
}

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length < 2) return null;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0,
    varX = 0,
    varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

type Sample = { date: string; oldScore: number; newScore: number; forwardReturn: number };

const FORWARD_TRADING_DAYS = 20; // ~1 calendar month of business days
const STEP_DAYS = 7; // sample weekly to keep FRED request volume + compute reasonable

async function run() {
  console.log("Fetching real historical FRED series (this can take a minute)...");
  const HISTORY_LIMIT = 5000;

  const [gold, dfii10, t10yie, dtwexbgs, vixcls, dgs2, gdpc1, unrate, cpi, fedfunds] = await Promise.all([
    fetchSeries("GOLDAMGBD228NLBM", HISTORY_LIMIT),
    fetchSeries("DFII10", HISTORY_LIMIT),
    fetchSeries("T10YIE", HISTORY_LIMIT),
    fetchSeries("DTWEXBGS", HISTORY_LIMIT),
    fetchSeries("VIXCLS", HISTORY_LIMIT),
    fetchSeries("DGS2", HISTORY_LIMIT),
    fetchSeries("GDPC1", 400),
    fetchSeries("UNRATE", 400),
    fetchSeries("CPIAUCSL", 400),
    fetchSeries("FEDFUNDS", 400),
  ]);

  console.log(`Gold price observations: ${gold.length}. Building the evaluation date grid...`);

  const goldByDate = new Map(gold.map((p) => [p.date, p.value]));
  const goldDates = gold.map((p) => p.date);

  const samples: Sample[] = [];

  for (let i = 0; i < goldDates.length; i += STEP_DAYS) {
    const asOf = goldDates[i];
    const forwardIndex = i + FORWARD_TRADING_DAYS;
    if (forwardIndex >= goldDates.length) break; // no real forward return available yet

    const priceNow = goldByDate.get(asOf)!;
    const priceForward = goldByDate.get(goldDates[forwardIndex])!;
    const forwardReturn = (priceForward - priceNow) / priceNow;

    const realYield = toSeriesRead(windowEndingAt(dfii10, asOf, GOLD_LOOKBACK), 2);
    const usd = toSeriesRead(windowEndingAt(dtwexbgs, asOf, GOLD_LOOKBACK), 2);
    const fedCut = toSeriesRead(windowEndingAt(dgs2, asOf, GOLD_LOOKBACK), 2);
    const safeHaven = toSeriesRead(windowEndingAt(vixcls, asOf, GOLD_LOOKBACK), 2);
    const breakeven = toSeriesRead(windowEndingAt(t10yie, asOf, GOLD_LOOKBACK), 2);

    const newRegime = scoreGoldMacroRegime({ realYield, usd, fedCut, safeHaven, breakeven });
    const gdpWindow = windowEndingAt(gdpc1, asOf, 8); // ~2 years of quarterly data
    const unrateWindow = windowEndingAt(unrate, asOf, 12); // ~1 year of monthly data
    const cpiWindow = windowEndingAt(cpi, asOf, 12);
    const fedfundsWindow = windowEndingAt(fedfunds, asOf, 12);

    const newGrowthLabor = growthLaborScore(gdpWindow, unrateWindow, -1);
    const oldGrowthLabor = growthLaborScore(gdpWindow, unrateWindow, 1);
    const oldInflation = oldInflationScore(cpiWindow);
    const oldRates = oldInterestRatesScore(fedfundsWindow);

    if (newRegime.interestRatesFreshness === "unavailable" && newRegime.inflationFreshness === "unavailable") continue;
    if (newGrowthLabor === null || oldGrowthLabor === null || oldInflation === null || oldRates === null) continue;

    const newScore = newRegime.interestRatesRaw + newRegime.inflationRaw + newGrowthLabor;
    const oldScore = oldRates + oldInflation + oldGrowthLabor;

    samples.push({ date: asOf, oldScore, newScore, forwardReturn });
  }

  console.log(`\nEvaluated ${samples.length} historical points (weekly, ${FORWARD_TRADING_DAYS}-trading-day forward return each).\n`);

  if (samples.length < 10) {
    console.log("Too few samples to report meaningful statistics — check FRED coverage for the requested series.");
    return;
  }

  function hitRate(scoreOf: (s: Sample) => number): number {
    const decisive = samples.filter((s) => scoreOf(s) !== 0);
    if (decisive.length === 0) return NaN;
    const hits = decisive.filter((s) => Math.sign(scoreOf(s)) === Math.sign(s.forwardReturn)).length;
    return (hits / decisive.length) * 100;
  }

  const oldCorr = pearsonCorrelation(
    samples.map((s) => s.oldScore),
    samples.map((s) => s.forwardReturn)
  );
  const newCorr = pearsonCorrelation(
    samples.map((s) => s.newScore),
    samples.map((s) => s.forwardReturn)
  );

  console.log("Model                | Hit rate (sign matches fwd return) | Correlation with fwd return");
  console.log("----------------------|-------------------------------------|-----------------------------");
  console.log(`OLD (generic, +growth)| ${hitRate((s) => s.oldScore).toFixed(1)}%`.padEnd(60) + `| ${oldCorr?.toFixed(3) ?? "n/a"}`);
  console.log(`NEW (goldMacroRegime) | ${hitRate((s) => s.newScore).toFixed(1)}%`.padEnd(60) + `| ${newCorr?.toFixed(3) ?? "n/a"}`);

  console.log(
    `\nVerdict: the new model's forward-return correlation is ${newCorr !== null && oldCorr !== null ? (newCorr > oldCorr ? "HIGHER" : newCorr < oldCorr ? "LOWER" : "EQUAL") : "not comparable"} than the old model's over this window.`
  );
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
