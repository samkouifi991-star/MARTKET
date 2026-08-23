// Scoring Engine V2 orchestrator — wires every module built in M1-M5 into
// the full pipeline from the plan's architecture diagram:
//   factor engines (reused from V1) -> asset-specific interpretation ->
//   market regime -> correlation/family controls -> freshness+reliability
//   -> event shock+decay -> raw score -> smoothing+hysteresis -> integrity
//   validation -> canonical current V2 score (shadow tables only).
//
// Deliberately reuses V1's existing factor resolvers (pipeline/technical.ts,
// seasonality.ts, positioning.ts, sentiment.ts, macro.ts, news.ts) as V2's
// baseline for all 9 ScoreFactorKeys rather than reimplementing them — V1's
// macro.ts already has the correct asset-specific polarity for Gold (fixed
// in a prior session) and the correct differential/primary-local-model
// logic for FX/Indices/Crypto. V2's own asset-interpretation/* modules only
// handle the NEW piece V1 never had: turning a detected economic surprise
// into a fast-moving, decaying event shock layered on top of those same
// baseline factors.
//
// SHADOW MODE: every write here goes to the current_market_scores_v2/
// current_factor_scores_v2/market_scores_v2/factor_scores_v2/
// scoring_shadow_comparisons tables — never V1's tables. No user-facing
// page reads anything this file writes.
import { getInstrument } from "@/lib/instruments";
import { Bias, ScoreFactor, ScoreFactorKey } from "@/lib/types";
import { DataMode } from "@/services/data-mode";
import { CCY_TO_COUNTRY } from "@/lib/scoring";
import { resolveTechnicalFactor } from "@/lib/pipeline/technical";
import { resolveSeasonalityFactor } from "@/lib/pipeline/seasonality";
import { resolveInstitutionalFactor } from "@/lib/pipeline/positioning";
import { resolveRetailSentimentFactor } from "@/lib/pipeline/sentiment";
import { resolveEconomicGrowthFactor, resolveInflationFactor, resolveLaborFactor, resolveInterestRatesFactor } from "@/lib/pipeline/macro";
import { resolveNewsFactor } from "@/lib/pipeline/news";
import { contributionFor } from "@/lib/pipeline/scoring-engine";
import { ResolvedFactor } from "@/lib/pipeline/types";
import { resolveActiveScoringConfig, ResolvedScoringConfig } from "@/lib/pipeline/scoring-config";
import { macroPolarityClassFor, MacroPolarityClass } from "@/lib/pipeline/asset-polarity";
import { getFredSeriesWithFallback } from "@/services/market-data/last-known-good";
import { getCurrentScore } from "@/db/queries/scores";
import {
  getCurrentScoreV2,
  getRecentFactorScoreV2Snapshots,
  MarketScoreV2,
  recordIntegrityError,
  recordScoreHistoryV2,
  recordShadowComparison,
  upsertCurrentScoreV2,
} from "@/db/queries/scoring-v2";
import { getRecentEventShocks, getRecentSurprisesForCountries, hasEventShockForRelease, recordEventShock, RecentSurpriseRow } from "@/db/queries/economic-releases";
import { indicatorCategory } from "@/services/economic-calendar/indicator-taxonomy";
import { FACTOR_FAMILY, FamilyContribution, applyFamilyCaps, FamilyKey } from "./factor-families";
import { classifyBiasWithHysteresis } from "./hysteresis";
import { selectSmoothingAlpha, smoothedScore } from "./smoothing";
import { confirmExtremeBias, FamilyDirection } from "./extreme-confirmation";
import { validateScoreIntegrity } from "./integrity";
import { classifyRegime, MacroRegime, RegimeInputs } from "./regime";
import { computeConfidenceV2 } from "./confidence-v2";
import { reliabilityMultiplier } from "./reliability";
import { decayedContribution, StoredEventShock } from "./event-shock";
import { computeRateDecisionShock } from "./central-bank-event";
import { computeGoldSurpriseShock, goldRateDecisionShock } from "./asset-interpretation/gold";
import { computeFxRelativeSurpriseShockOneSided } from "./asset-interpretation/fx";
import { computeIndicesGrowthShock, computeIndicesInflationShock } from "./asset-interpretation/indices";
import { computeCryptoGrowthLaborShock, computeCryptoRegimeShock } from "./asset-interpretation/crypto";

const RESOLVERS: Record<ScoreFactorKey, (symbol: string, mode: DataMode, storageOnly?: boolean) => Promise<ResolvedFactor>> = {
  institutional: resolveInstitutionalFactor,
  retailSentiment: resolveRetailSentimentFactor,
  technical: resolveTechnicalFactor,
  seasonality: resolveSeasonalityFactor,
  economicGrowth: resolveEconomicGrowthFactor,
  inflation: resolveInflationFactor,
  labor: resolveLaborFactor,
  interestRates: resolveInterestRatesFactor,
  news: resolveNewsFactor,
};

const REGIME_LOOKBACK = 60;

async function fetchRegimeInputs(storageOnly: boolean): Promise<RegimeInputs> {
  const [realYield, usd, vix] = await Promise.all([
    getFredSeriesWithFallback("US", "realYield10y", REGIME_LOOKBACK, storageOnly),
    getFredSeriesWithFallback("US", "usdIndexBroad", REGIME_LOOKBACK, storageOnly),
    getFredSeriesWithFallback("US", "vix", REGIME_LOOKBACK, storageOnly),
  ]);
  const usable = (r: { status: string; value: unknown[] | null }) => (r.status === "live" || r.status === "delayed" || r.status === "stale") && !!r.value && r.value.length >= 2;
  const points = (r: { value: { value: number }[] | null }) => r.value as { value: number }[];
  const trendOf = (r: { status: string; value: { value: number }[] | null }) => (usable(r) ? points(r)[points(r).length - 1].value - points(r)[0].value : 0);
  const levelOf = (r: { status: string; value: { value: number }[] | null }, fallback: number) => (usable(r) ? points(r)[points(r).length - 1].value : fallback);
  return { realYieldTrend: trendOf(realYield), usdTrend: trendOf(usd), vixLevel: levelOf(vix, 18), vixTrend: trendOf(vix) };
}

function relevantCountries(symbol: string): string[] {
  const instrument = getInstrument(symbol);
  if (!instrument) return [];
  if (instrument.currencies) {
    const [base, quote] = instrument.currencies;
    return [CCY_TO_COUNTRY[base], CCY_TO_COUNTRY[quote]].filter((c): c is string => !!c);
  }
  return [instrument.macroCountry ?? "US"];
}

type NewShockDetection = { factorKey: string | null; contribution: number; importanceTier: RecentSurpriseRow["importanceTier"] };

/** Translates any not-yet-shocked recent surprise relevant to this symbol
 * into a signed contribution via the appropriate asset-interpretation
 * module, records it (idempotent — see hasEventShockForRelease), and
 * returns what was newly created this cycle (used to decide the
 * smoothing alpha and whether this cycle counts as a "HIGH impact event"
 * for history-persistence purposes). */
async function detectAndRecordNewShocks(symbol: string, polarityClass: MacroPolarityClass, regime: MacroRegime, maxContribution: number): Promise<NewShockDetection[]> {
  const instrument = getInstrument(symbol);
  if (!instrument) return [];
  const countries = relevantCountries(symbol);
  const surprises = await getRecentSurprisesForCountries(countries);
  const newlyCreated: NewShockDetection[] = [];

  for (const surprise of surprises) {
    if (await hasEventShockForRelease(symbol, surprise.id)) continue;

    let contribution: number | null = null;
    let factorKey: string | null = null;
    const category = indicatorCategory(surprise.indicatorKey);

    if (category === "rateDecision" && surprise.forecast !== null) {
      const generic = computeRateDecisionShock(surprise.actual, surprise.forecast);
      contribution = polarityClass === "PreciousMetals" ? goldRateDecisionShock(generic) : generic;
      factorKey = "interestRates";
    } else if (surprise.surpriseZ !== null) {
      if (polarityClass === "PreciousMetals") {
        contribution = computeGoldSurpriseShock(surprise.indicatorKey, surprise.surpriseZ);
        factorKey = category === "inflation" ? "inflation" : category === "growthLabor" ? "economicGrowth" : null;
      } else if (polarityClass === "FX" && instrument.currencies) {
        const baseCountry = CCY_TO_COUNTRY[instrument.currencies[0]];
        contribution = computeFxRelativeSurpriseShockOneSided(surprise.surpriseZ, surprise.country === baseCountry);
        factorKey = null; // relative-economics shocks apply to the total score, not one V1 factor slot
      } else if (polarityClass === "EquityIndices") {
        if (category === "inflation") {
          contribution = computeIndicesInflationShock(surprise.surpriseZ);
          factorKey = "inflation";
        } else if (category === "growthLabor") {
          contribution = computeIndicesGrowthShock(surprise.surpriseZ, regime);
          factorKey = "economicGrowth";
        }
      } else if (polarityClass === "Crypto" && category === "growthLabor") {
        contribution = computeCryptoGrowthLaborShock(surprise.surpriseZ);
        factorKey = "economicGrowth";
      }
    }

    if (contribution === null || contribution === 0) continue;
    const clamped = Math.max(-maxContribution, Math.min(maxContribution, contribution));
    await recordEventShock({ symbol, factorKey, sourceReleaseId: surprise.id, initialContribution: clamped, importanceTier: surprise.importanceTier });
    newlyCreated.push({ factorKey, contribution: clamped, importanceTier: surprise.importanceTier });
  }

  return newlyCreated;
}

export type ComputeMarketScoreV2Options = { persist?: boolean; storageOnly?: boolean };

export async function computeMarketScoreV2(symbol: string, mode: DataMode, options: ComputeMarketScoreV2Options = {}): Promise<MarketScoreV2> {
  const storageOnly = options.storageOnly ?? false;
  const instrument = getInstrument(symbol);
  if (!instrument) throw new Error(`Unknown instrument ${symbol}`);

  const scoringConfig: ResolvedScoringConfig = await resolveActiveScoringConfig();
  const v2Settings = scoringConfig.v2Settings!; // resolveActiveScoringConfig always sets this (bootstrap default when unsaved)

  const [resolvedByKey, regimeInputs, previousV2, previousV1] = await Promise.all([
    (async () => {
      const keys = Object.keys(RESOLVERS) as ScoreFactorKey[];
      const resolved = await Promise.all(keys.map((key) => RESOLVERS[key](symbol, mode, storageOnly)));
      return new Map(keys.map((key, i) => [key, resolved[i]]));
    })(),
    fetchRegimeInputs(storageOnly),
    getCurrentScoreV2(symbol).catch(() => null),
    getCurrentScore(symbol).catch(() => null),
  ]);

  const regime = classifyRegime(regimeInputs);
  const polarityClass = macroPolarityClassFor(instrument);

  const newShocks = await detectAndRecordNewShocks(symbol, polarityClass, regime, v2Settings.eventShock.maxContribution).catch(() => [] as NewShockDetection[]);
  const activeShockRows: StoredEventShock[] = (await getRecentEventShocks(symbol).catch(() => [])).map((s) => ({ symbol: s.symbol, factorKey: s.factorKey, initialContribution: s.initialContribution, importanceTier: s.importanceTier, occurredAt: s.occurredAt }));

  let eventTotal = 0;
  const eventByFactorKey = new Map<string, number>();
  const now = new Date();
  for (const shock of activeShockRows) {
    const hoursElapsed = (now.getTime() - new Date(shock.occurredAt).getTime()) / 3_600_000;
    const current = decayedContribution(shock.initialContribution, hoursElapsed, v2Settings.eventShock.decayHalfLifeHoursByTier[shock.importanceTier]);
    if (current === 0) continue;
    if (shock.factorKey === null) eventTotal += current;
    else eventByFactorKey.set(shock.factorKey, (eventByFactorKey.get(shock.factorKey) ?? 0) + current);
  }
  // Crypto's regime read is a continuous driver, not tied to any one
  // release — recomputed fresh every cycle rather than decayed.
  if (polarityClass === "Crypto") eventTotal += computeCryptoRegimeShock(regime);

  const baseFactors = Object.keys(RESOLVERS) as ScoreFactorKey[];
  const contributions: FamilyContribution[] = baseFactors.map((key) => {
    const resolved = resolvedByKey.get(key)!;
    const base = contributionFor(resolved, scoringConfig.weights[key]);
    const shock = eventByFactorKey.get(key) ?? 0;
    return { key, contribution: Number((base + shock).toFixed(2)) };
  });
  contributions.push({ key: "event", contribution: Number(eventTotal.toFixed(2)) });

  const capped = applyFamilyCaps(contributions, v2Settings.familyCaps);
  const cappedByKey = new Map(capped.map((c) => [c.key, c.contribution]));

  const rawTotal = Math.max(-10, Math.min(10, Number(capped.reduce((s, c) => s + c.contribution, 0).toFixed(2))));

  const hadHighImpactEventThisCycle = newShocks.some((s) => s.importanceTier === "HIGH");
  const alpha = selectSmoothingAlpha(hadHighImpactEventThisCycle, v2Settings.smoothingAlpha, v2Settings.smoothingAlphaHighImpact);
  const smoothed = Math.max(-10, Math.min(10, smoothedScore(rawTotal, previousV2?.totalScore ?? null, alpha)));

  const proposedBias = classifyBiasWithHysteresis(smoothed, previousV2?.bias ?? null, v2Settings.hysteresis);

  const confidenceFactors = baseFactors.map((key) => resolvedByKey.get(key)!);
  const confidence = computeConfidenceV2({ factors: confidenceFactors, reliabilityMultipliers: [reliabilityMultiplier(null)], regime, regimeInputs });

  const familyDirections: FamilyDirection[] = Array.from(new Set(Object.values(FACTOR_FAMILY))).map((family) => {
    const total = capped.filter((c) => FACTOR_FAMILY[c.key as FamilyKey] === family).reduce((s, c) => s + c.contribution, 0);
    return { family, contribution: total };
  });
  const bias: Bias = confirmExtremeBias(proposedBias, confidence, familyDirections, v2Settings.minConfidenceForExtreme);

  const nowIso = now.toISOString();
  const finalFactors: ScoreFactor[] = baseFactors.map((key) => {
    const resolved = resolvedByKey.get(key)!;
    return {
      key,
      contribution: cappedByKey.get(key) ?? 0,
      rawScore: resolved.rawScore,
      weight: scoringConfig.weights[key],
      explanation: resolved.explanation,
      source: resolved.source,
      provider: resolved.provider,
      freshness: resolved.freshness,
      lastUpdated: resolved.lastUpdated,
      nextUpdate: resolved.nextUpdate,
    };
  });
  // "event" is a V2-only pseudo-factor, not one of V1's 9 real
  // ScoreFactorKeys (which V1's DB columns/admin UI/weights config all
  // depend on staying exactly as-is) — cast deliberately at this one
  // boundary rather than widening the shared union.
  finalFactors.push({
    key: "event" as ScoreFactorKey,
    contribution: cappedByKey.get("event") ?? 0,
    rawScore: cappedByKey.get("event") ?? 0,
    weight: 1,
    explanation: activeShockRows.length > 0 ? `${activeShockRows.length} active economic-release event shock(s) contributing to this score.` : "No active economic-release event shocks.",
    source: "Scoring Engine V2 event-shock layer",
    provider: "internal",
    freshness: "live",
    lastUpdated: nowIso,
    nextUpdate: nowIso,
  });

  // Smoothing (requirement #16) blends this cycle's raw total with the
  // previous cycle's published total, so the PUBLIC totalScore (smoothed)
  // no longer literally equals the sum of the 9 base + event
  // contributions above (rawTotal) — that gap is made its own visible
  // pseudo-factor here instead of silently breaking requirement #1's
  // "Total Score = sum of visible factor contributions" invariant, which
  // validateScoreIntegrity below enforces unconditionally.
  const smoothingAdjustment = Number((smoothed - rawTotal).toFixed(2));
  finalFactors.push({
    key: "smoothing" as ScoreFactorKey,
    contribution: smoothingAdjustment,
    rawScore: smoothingAdjustment,
    weight: 1,
    explanation: `Smoothing (α=${alpha}) blending this cycle's raw score (${rawTotal}) with the previous cycle's published score${previousV2 ? ` (${previousV2.totalScore})` : " (none yet — no adjustment)"}.`,
    source: "Scoring Engine V2 smoothing layer",
    provider: "internal",
    freshness: "live",
    lastUpdated: nowIso,
    nextUpdate: nowIso,
  });

  const change24h = previousV2 ? Number((smoothed - previousV2.totalScore).toFixed(2)) : 0;

  const integrity = validateScoreIntegrity({ totalScore: smoothed, factors: finalFactors, confidence, scoringVersionId: scoringConfig.id, bootstrapConfigAllowed: scoringConfig.id === null });

  if (!integrity.valid) {
    await recordIntegrityError({ symbol, errors: integrity.errors, scoringVersionId: scoringConfig.id }).catch(() => {});
    if (previousV2) return previousV2; // keep the previous canonical score — never publish a broken calculation
    // No prior V2 score to fall back to (first-ever computation failed
    // integrity) — return a clearly-labeled unavailable score rather than
    // throwing, so a caller iterating many symbols doesn't abort entirely.
    return { symbol, totalScore: 0, rawScore: 0, bias: "Neutral", confidence: 0, change24h: 0, factors: [], history: [], lastUpdated: nowIso };
  }

  const result: MarketScoreV2 = { symbol, totalScore: smoothed, rawScore: rawTotal, bias, confidence, change24h, factors: finalFactors, history: [], lastUpdated: nowIso };

  if (options.persist) {
    await upsertCurrentScoreV2(result, scoringConfig.id).catch(() => {});

    // Requirement #10's materiality gate: only append a genuine history
    // observation when it will actually mean something on the chart.
    const scoreDelta = previousV2 ? Math.abs(smoothed - previousV2.totalScore) : Infinity;
    const biasChanged = previousV2 ? previousV2.bias !== bias : true;
    if (scoreDelta >= 0.25 || biasChanged || hadHighImpactEventThisCycle) {
      await recordScoreHistoryV2(result, scoringConfig.id).catch(() => {});
    }

    if (previousV1) {
      await recordShadowComparison({
        symbol,
        v1Score: previousV1.totalScore,
        v1Bias: previousV1.bias,
        v1Confidence: previousV1.confidence,
        v2Score: smoothed,
        v2Bias: bias,
        v2Confidence: confidence,
      }).catch(() => {});
    }
  }

  return result;
}

// Re-exported so a consumer (e.g. attribution.ts, a later milestone) that
// already has factor snapshots doesn't need to re-derive family
// groupings independently.
export { getRecentFactorScoreV2Snapshots };
