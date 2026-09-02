// Phase 19 — automated public-launch readiness audit. Runs against every
// LAUNCH_READY market using ONLY real, storage-first production state (the
// same storage-only reads pipeline-health.ts already uses, never a live
// provider call) and reports PASS/WARNING/FAIL per market, per the user's
// explicit spec: current price+age, latest daily candle+age, H4/H1
// availability, technical/seasonality/CFTC/retail-sentiment/macro status,
// canonical score, confidence, contribution-sum invariant, last score
// computation, and whether any factor is a demo fallback.
//
// This module only READS and CLASSIFIES — it does not itself demote a
// FAIL market from STRICT_LIVE_SYMBOLS. That promotion/demotion lever
// already exists (services/data-mode.ts) and has been used deliberately,
// one market at a time, with its own verification pass, throughout this
// project's history; a FAIL verdict here is the trigger for that same
// manual, reviewed action, not an automatic runtime gate.
import { Instrument, MarketScore } from "@/lib/types";
import { publicInstruments } from "@/services/market-coverage";
import { getCurrentScore } from "@/db/queries/scores";
import {
  getQuoteWithFallback,
  getDailyCandlesWithFallback,
  getIntradayCandlesWithFallback,
  getPositioningWithFallback,
  getFredSeriesWithFallback,
  getRetailSentimentFromStorage,
} from "@/services/market-data/last-known-good";
import { computeHistoricalSampleDepth } from "@/lib/engines/seasonality";
import { MIN_YEARS_FOR_LIVE_SEASONALITY } from "./market-detail";
import { primaryMacroCountry } from "./scorecard";

export type AuditField = { status: string; ageHours: number | null; beyondSla: boolean };

const BEYOND_SLA_STATUSES = new Set(["stale", "unavailable", "error"]);

function fieldFrom(status: string, sourceUpdatedAt: string | null, fetchedAt: string): AuditField {
  const ts = sourceUpdatedAt ?? fetchedAt ?? null;
  const ageHours = ts ? (Date.now() - new Date(ts).getTime()) / 3_600_000 : null;
  return { status, ageHours, beyondSla: BEYOND_SLA_STATUSES.has(status) };
}

const SCORE_COMPUTATION_SLA_HOURS = 36;

function scoreComputationField(lastUpdated: string | null): AuditField {
  if (!lastUpdated) return { status: "unavailable", ageHours: null, beyondSla: true };
  const ageHours = (Date.now() - new Date(lastUpdated).getTime()) / 3_600_000;
  return { status: ageHours <= SCORE_COMPUTATION_SLA_HOURS ? "live" : "stale", ageHours, beyondSla: ageHours > SCORE_COMPUTATION_SLA_HOURS };
}

/** Contribution-sum invariant: every ScoreFactor's `contribution` (its
 * already-weighted contribution to the total) must sum to `totalScore` —
 * the same invariant scoring-engine.test.ts already enforces at the unit
 * level; this re-checks it against what's actually stored in production. */
const CONTRIBUTION_SUM_EPSILON = 0.05;

export function checkContributionSum(score: MarketScore): { valid: boolean; delta: number } {
  const sum = score.factors.reduce((s, f) => s + f.contribution, 0);
  const delta = Number((sum - score.totalScore).toFixed(4));
  return { valid: Math.abs(delta) <= CONTRIBUTION_SUM_EPSILON, delta };
}

/** A demo-fallback factor is marked "estimated" (see pipeline/types.ts's
 * demoFallbackFactor) — this should NEVER appear for a LAUNCH_READY
 * (STRICT_LIVE_SYMBOLS) market, since allowsDemoFallback() already refuses
 * demo fallback for any strict-live symbol. Finding one here means a real
 * integrity gap between the promotion list and what actually got stored. */
export function findDemoFallbackFactors(score: MarketScore): string[] {
  return score.factors.filter((f) => f.freshness === "estimated").map((f) => f.key);
}

export type LaunchAuditRow = {
  symbol: string;
  price: AuditField;
  dailyCandle: AuditField;
  h4Candle: AuditField;
  h1Candle: AuditField;
  technical: AuditField;
  seasonality: AuditField;
  cftcReport: AuditField;
  retailSentiment: AuditField;
  macro: AuditField;
  scoreComputation: AuditField;
  canonicalScore: number | null;
  confidence: number | null;
  contributionSumValid: boolean | null;
  contributionSumDelta: number | null;
  demoFallbackFactors: string[];
  verdict: "PASS" | "WARNING" | "FAIL";
  reasons: string[];
};

function seasonalityField(candles: Awaited<ReturnType<typeof getDailyCandlesWithFallback>>): AuditField {
  if (!candles.value) return fieldFrom(candles.status === "error" ? "error" : "unavailable", candles.sourceUpdatedAt, candles.fetchedAt);
  const depth = computeHistoricalSampleDepth(candles.value);
  if (!depth || depth.yearsSpanned < MIN_YEARS_FOR_LIVE_SEASONALITY) {
    return { status: "unavailable", ageHours: null, beyondSla: true };
  }
  return fieldFrom(candles.status, candles.sourceUpdatedAt, candles.fetchedAt);
}

function classifyVerdict(row: Omit<LaunchAuditRow, "verdict" | "reasons">): { verdict: LaunchAuditRow["verdict"]; reasons: string[] } {
  const reasons: string[] = [];

  // FAIL — the market cannot honestly be shown to a paying customer at all.
  if (row.canonicalScore === null) reasons.push("No canonical score is currently stored for this market.");
  if (row.price.beyondSla) reasons.push(`Current price is ${row.price.status} — no usable real price.`);
  if (row.dailyCandle.beyondSla) reasons.push(`Daily candle history is ${row.dailyCandle.status} — technical/seasonality reads cannot be trusted.`);
  if (row.contributionSumValid === false) reasons.push(`Factor contributions sum to a value ${row.contributionSumDelta! >= 0 ? "+" : ""}${row.contributionSumDelta} away from the stored total score — invariant violated.`);
  if (row.demoFallbackFactors.length > 0) reasons.push(`Demo-fallback factor(s) found on a LAUNCH_READY market: ${row.demoFallbackFactors.join(", ")}.`);
  if (reasons.length > 0) return { verdict: "FAIL", reasons };

  // WARNING — real data, but degraded somewhere non-fatal.
  const warnings: string[] = [];
  if (row.scoreComputation.beyondSla) warnings.push(`Score last computed ${row.scoreComputation.ageHours?.toFixed(1) ?? "?"}h ago — beyond the ${SCORE_COMPUTATION_SLA_HOURS}h SLA.`);
  if (row.h4Candle.beyondSla) warnings.push("4H candles beyond SLA.");
  if (row.h1Candle.beyondSla) warnings.push("1H candles beyond SLA.");
  if (row.cftcReport.beyondSla) warnings.push("CFTC report beyond SLA.");
  if (row.retailSentiment.beyondSla) warnings.push("Retail sentiment beyond SLA.");
  if (row.macro.beyondSla) warnings.push("Macro (FRED) data beyond SLA.");
  if (row.seasonality.beyondSla) warnings.push("Seasonality sample too thin or unavailable.");
  if (warnings.length > 0) return { verdict: "WARNING", reasons: warnings };

  return { verdict: "PASS", reasons: [] };
}

async function auditRow(instrument: Instrument): Promise<LaunchAuditRow> {
  const symbol = instrument.symbol;
  const country = primaryMacroCountry(instrument);

  const [quote, daily, h4, h1, positioning, retail, macro, score] = await Promise.all([
    getQuoteWithFallback(symbol, true),
    getDailyCandlesWithFallback(symbol, 260, true),
    getIntradayCandlesWithFallback(symbol, "4hour", true),
    getIntradayCandlesWithFallback(symbol, "1hour", true),
    getPositioningWithFallback(symbol, true),
    getRetailSentimentFromStorage(symbol),
    getFredSeriesWithFallback(country, "cpi", 2, true),
    getCurrentScore(symbol, { includeHistory: false }).catch(() => null),
  ]);
  const seasonalityCandles = await getDailyCandlesWithFallback(symbol, 20 * 365, true);

  const dailyField = fieldFrom(daily.status, daily.sourceUpdatedAt, daily.fetchedAt);
  const contribution = score ? checkContributionSum(score) : null;

  const base = {
    symbol,
    price: fieldFrom(quote.status, quote.sourceUpdatedAt, quote.fetchedAt),
    dailyCandle: dailyField,
    h4Candle: fieldFrom(h4.status, h4.sourceUpdatedAt, h4.fetchedAt),
    h1Candle: fieldFrom(h1.status, h1.sourceUpdatedAt, h1.fetchedAt),
    technical: dailyField, // technical indicators are derived directly from daily candles — same freshness
    seasonality: seasonalityField(seasonalityCandles),
    cftcReport: fieldFrom(positioning.status, positioning.sourceUpdatedAt, positioning.fetchedAt),
    retailSentiment: fieldFrom(retail.status, retail.sourceUpdatedAt, retail.fetchedAt),
    macro: fieldFrom(macro.status, macro.sourceUpdatedAt, macro.fetchedAt),
    scoreComputation: scoreComputationField(score?.lastUpdated ?? null),
    canonicalScore: score?.totalScore ?? null,
    confidence: score?.confidence ?? null,
    contributionSumValid: contribution?.valid ?? null,
    contributionSumDelta: contribution?.delta ?? null,
    demoFallbackFactors: score ? findDemoFallbackFactors(score) : [],
  };

  const { verdict, reasons } = classifyVerdict(base);
  return { ...base, verdict, reasons };
}

export async function runLaunchAudit(): Promise<LaunchAuditRow[]> {
  return Promise.all(publicInstruments().map(auditRow));
}
