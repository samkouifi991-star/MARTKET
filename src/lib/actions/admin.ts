"use server";

// Admin's "Save & version" — the real write path behind the scoring-weights
// and bias-threshold cards on /admin. This used to be pure client-side
// React state (see the git history of AdminClient.tsx): the button
// appended a fake audit-log entry and never touched Neon, so the scoring
// engine kept computing every score from the hardcoded DEFAULT_FACTOR_
// WEIGHTS/DEFAULT_BIAS_THRESHOLDS no matter what the Admin UI showed —
// exactly the bug behind "Admin says Retail 5%, BTCUSD still shows 10%".
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import { createScoringConfiguration } from "@/db/queries/scoring-config";
import { computeLiveMarketScore } from "@/lib/pipeline/scoring-engine";
import { resolveActiveScoringConfig } from "@/lib/pipeline/scoring-config";
import { computeMarketScoreV2 } from "@/lib/scoring-v2/engine";
import { DEFAULT_SCORING_V2_SETTINGS, ScoringV2Settings } from "@/lib/scoring-v2/config";
import { DATA_MODE, isDemoOnly, strictLiveSymbolList } from "@/services/data-mode";
import { SCORE_FACTOR_KEYS, ScoreFactorKey } from "@/lib/types";
import { BiasThreshold, DEFAULT_BIAS_THRESHOLDS } from "@/lib/config";

export type AdminActionState =
  | { error: string; success?: undefined }
  | { success: string; error?: undefined; versionId?: number; updatedAt?: string }
  | undefined;

const WEIGHT_SUM_EPSILON = 0.001; // weights are fractions (0..1) — 100% == 1

function parseWeights(formData: FormData): { weights: Record<ScoreFactorKey, number> } | { error: string } {
  const weights = {} as Record<ScoreFactorKey, number>;
  for (const key of SCORE_FACTOR_KEYS) {
    const raw = formData.get(`weight:${key}`);
    const value = Number(raw);
    if (raw === null || !Number.isFinite(value) || value < 0) return { error: `Invalid weight for ${key}.` };
    weights[key] = value;
  }
  const sum = Object.values(weights).reduce((s, v) => s + v, 0);
  if (Math.abs(sum - 1) > WEIGHT_SUM_EPSILON) {
    return { error: `Weights must sum to exactly 100% — currently ${(sum * 100).toFixed(1)}%.` };
  }
  return { weights };
}

/** Same 5 bias labels, same order, as DEFAULT_BIAS_THRESHOLDS — all five,
 * including "Very Bearish", are user-editable numbers read straight from
 * the form. Requires all five to stay in strictly descending order — a
 * scrambled ladder would make classifyBias's first-match-wins scan
 * silently pick the wrong label. */
function parseBiasThresholds(formData: FormData): { biasThresholds: BiasThreshold[] } | { error: string } {
  const biasThresholds: BiasThreshold[] = [];
  for (let i = 0; i < DEFAULT_BIAS_THRESHOLDS.length; i++) {
    const bias = DEFAULT_BIAS_THRESHOLDS[i].bias;
    const raw = formData.get(`threshold:${i}`);
    const value = Number(raw);
    if (raw === null || !Number.isFinite(value)) return { error: `Invalid bias threshold for ${bias}.` };
    biasThresholds.push({ bias, min: value });
  }
  for (let i = 0; i < biasThresholds.length - 1; i++) {
    if (biasThresholds[i].min <= biasThresholds[i + 1].min) {
      return { error: `Bias thresholds must strictly decrease from ${biasThresholds[i].bias} to ${biasThresholds[i + 1].bias}.` };
    }
  }
  return { biasThresholds };
}

// Form field slugs for the 4 hysteresis/family-cap bias/family labels —
// avoids spaces in form field names.
const HYSTERESIS_BIAS_SLUGS: { bias: BiasThreshold["bias"]; slug: string }[] = [
  { bias: "Very Bullish", slug: "veryBullish" },
  { bias: "Bullish", slug: "bullish" },
  { bias: "Bearish", slug: "bearish" },
  { bias: "Very Bearish", slug: "veryBearish" },
];
const FAMILY_SLUGS: { family: ScoringV2Settings["familyCaps"][number]["family"]; slug: string }[] = [
  { family: "Macro", slug: "macro" },
  { family: "Positioning", slug: "positioning" },
  { family: "Technical", slug: "technical" },
  { family: "Event", slug: "event" },
];

/** Parses Scoring V2's full behavior-tuning config from the SAME submitted
 * form as weights/thresholds (requirement #24's "one Save & Version" for
 * the complete model). Falls back to DEFAULT_SCORING_V2_SETTINGS's own
 * value field-by-field when a v2:* field is absent — lets the V2 section
 * be introduced without breaking a form submission from before it existed. */
function parseV2Settings(formData: FormData): { v2Settings: ScoringV2Settings } | { error: string } {
  const num = (name: string, fallback: number): number | null => {
    const raw = formData.get(name);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const eventShockMax = num("v2:eventShockMax", DEFAULT_SCORING_V2_SETTINGS.eventShock.maxContribution);
  const decayHigh = num("v2:decayHigh", DEFAULT_SCORING_V2_SETTINGS.eventShock.decayHalfLifeHoursByTier.HIGH);
  const decayMedium = num("v2:decayMedium", DEFAULT_SCORING_V2_SETTINGS.eventShock.decayHalfLifeHoursByTier.MEDIUM);
  const decayLow = num("v2:decayLow", DEFAULT_SCORING_V2_SETTINGS.eventShock.decayHalfLifeHoursByTier.LOW);
  const minConfidenceForExtreme = num("v2:minConfidenceForExtreme", DEFAULT_SCORING_V2_SETTINGS.minConfidenceForExtreme);
  const smoothingAlpha = num("v2:smoothingAlpha", DEFAULT_SCORING_V2_SETTINGS.smoothingAlpha);
  const smoothingAlphaHighImpact = num("v2:smoothingAlphaHighImpact", DEFAULT_SCORING_V2_SETTINGS.smoothingAlphaHighImpact);

  if ([eventShockMax, decayHigh, decayMedium, decayLow, minConfidenceForExtreme, smoothingAlpha, smoothingAlphaHighImpact].some((v) => v === null)) {
    return { error: "Invalid Scoring V2 setting — every field must be a real number." };
  }
  if (minConfidenceForExtreme! < 0 || minConfidenceForExtreme! > 100) return { error: "Minimum confidence for an extreme label must be between 0 and 100." };
  if (smoothingAlpha! < 0 || smoothingAlpha! > 1 || smoothingAlphaHighImpact! < 0 || smoothingAlphaHighImpact! > 1) return { error: "Smoothing coefficients must be between 0 and 1." };

  const hysteresis: ScoringV2Settings["hysteresis"] = [];
  for (const { bias, slug } of HYSTERESIS_BIAS_SLUGS) {
    const fallbackEntry = DEFAULT_SCORING_V2_SETTINGS.hysteresis.find((h) => h.bias === bias)!;
    const enter = num(`v2:hysteresis:${slug}:enter`, fallbackEntry.enter);
    const exit = num(`v2:hysteresis:${slug}:exit`, fallbackEntry.exit);
    if (enter === null || exit === null) return { error: `Invalid hysteresis threshold for ${bias}.` };
    // Entry must be at least as extreme as exit (a Bullish/Very Bullish
    // exit above its own entry, or a Bearish/Very Bearish exit below its
    // own entry, would mean the band never actually holds anything).
    const isBullishSide = bias === "Very Bullish" || bias === "Bullish";
    if ((isBullishSide && exit > enter) || (!isBullishSide && exit < enter)) {
      return { error: `${bias}'s exit threshold must be less extreme than its entry threshold (a hysteresis band that can't hold anything).` };
    }
    hysteresis.push({ bias, enter, exit });
  }

  const familyCaps: ScoringV2Settings["familyCaps"] = [];
  for (const { family, slug } of FAMILY_SLUGS) {
    const fallbackEntry = DEFAULT_SCORING_V2_SETTINGS.familyCaps.find((f) => f.family === family)!;
    const maxContribution = num(`v2:familyCap:${slug}`, fallbackEntry.maxContribution);
    if (maxContribution === null || maxContribution < 0) return { error: `Invalid family cap for ${family}.` };
    familyCaps.push({ family, maxContribution });
  }

  return {
    v2Settings: {
      eventShock: { maxContribution: eventShockMax!, decayHalfLifeHoursByTier: { HIGH: decayHigh!, MEDIUM: decayMedium!, LOW: decayLow! } },
      minConfidenceForExtreme: minConfidenceForExtreme!,
      hysteresis,
      familyCaps,
      smoothingAlpha: smoothingAlpha!,
      smoothingAlphaHighImpact: smoothingAlphaHighImpact!,
    },
  };
}

function revalidateCanonicalScoreViews() {
  for (const path of ["/dashboard", "/top-setups", "/heatmap", "/watchlists", "/ai-analyst", "/admin"]) {
    revalidatePath(path);
  }
  revalidatePath("/markets", "layout"); // covers /markets and every /markets/[symbol]
}

export async function saveScoringConfiguration(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const admin = await requireAdmin();

  const weightsResult = parseWeights(formData);
  if ("error" in weightsResult) return weightsResult;
  const thresholdsResult = parseBiasThresholds(formData);
  if ("error" in thresholdsResult) return thresholdsResult;
  const v2SettingsResult = parseV2Settings(formData);
  if ("error" in v2SettingsResult) return v2SettingsResult;

  const configRow = await createScoringConfiguration({
    weights: weightsResult.weights,
    biasThresholds: thresholdsResult.biasThresholds,
    v2Settings: v2SettingsResult.v2Settings,
    createdBy: admin.email,
  });

  // Recompute every strict-live market's canonical current score against
  // the new weights/thresholds immediately — storageOnly:true means this
  // reads only already-stored factor data from Neon and never calls
  // OANDA/FMP/FRED/CFTC/IG/Myfxbook. Demo mode has no live pipeline at all
  // (computeLiveMarketScore throws for it by design), so there's nothing
  // to recompute there — the demo generator reads lib/config.ts's
  // defaults directly and isn't part of this canonical-score system.
  let recomputed = 0;
  let failed = 0;
  if (!isDemoOnly()) {
    const scoringConfig = { id: configRow.id, weights: configRow.weights, biasThresholds: configRow.biasThresholds };
    const symbols = strictLiveSymbolList();
    const results = await Promise.allSettled(
      symbols.map((symbol) => computeLiveMarketScore(symbol, DATA_MODE, { storageOnly: true, updateCurrent: true, scoringConfig, awaitPersist: true }))
    );
    recomputed = results.filter((r) => r.status === "fulfilled").length;
    failed = results.filter((r) => r.status === "rejected").length;
  }

  revalidateCanonicalScoreViews();

  return {
    success: isDemoOnly()
      ? `Configuration saved — v${configRow.id} active.`
      : `Configuration saved — v${configRow.id} active — recomputed ${recomputed}/${recomputed + failed} strict-live markets.`,
    versionId: configRow.id,
    updatedAt: configRow.createdAt.toISOString(),
  };
}

/** "Re-run all calculations" — forces every strict-live market to
 * recompute against the CURRENTLY active configuration (no new version),
 * for cases like a data-source outage resolving mid-day where the stored
 * factor data has changed but no weight/threshold edit triggered a
 * recompute. Same storageOnly:true rule: never calls a live provider. */
export async function recomputeAllScores(): Promise<AdminActionState> {
  await requireAdmin();

  if (isDemoOnly()) return { success: "Demo mode has no live pipeline to recompute." };

  const scoringConfig = await resolveActiveScoringConfig();
  const symbols = strictLiveSymbolList();
  const results = await Promise.allSettled(
    symbols.map((symbol) => computeLiveMarketScore(symbol, DATA_MODE, { storageOnly: true, updateCurrent: true, scoringConfig, awaitPersist: true }))
  );
  const recomputed = results.filter((r) => r.status === "fulfilled").length;

  revalidateCanonicalScoreViews();

  return { success: `Recalculated ${recomputed}/${symbols.length} strict-live markets from stored factor data.` };
}

/** The manual "Recompute V2 now" trigger (per this session's chosen
 * infra approach — see the plan's rollout notes): Scoring Engine V2 has
 * no automatic sub-daily cron yet, so this is how a fresh V2 shadow
 * computation gets triggered on demand after e.g. a new economic release
 * has been detected. storageOnly:true, same as V1's recompute actions —
 * never calls a live provider. Writes ONLY to the V2 shadow tables
 * (current_market_scores_v2 etc.) — no V1-facing page is revalidated,
 * since nothing V1-facing reads V2's output. */
export async function recomputeScoresV2Now(): Promise<AdminActionState> {
  await requireAdmin();

  if (isDemoOnly()) return { success: "Demo mode has no live pipeline to recompute." };

  const symbols = strictLiveSymbolList();
  const results = await Promise.allSettled(symbols.map((symbol) => computeMarketScoreV2(symbol, DATA_MODE, { storageOnly: true, persist: true })));
  const recomputed = results.filter((r) => r.status === "fulfilled").length;

  revalidatePath("/admin/scoring-v2");

  return { success: `Scoring Engine V2 (shadow mode): recalculated ${recomputed}/${symbols.length} strict-live markets.` };
}
