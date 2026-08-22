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
import { DATA_MODE, isDemoOnly, strictLiveSymbolList } from "@/services/data-mode";
import { SCORE_FACTOR_KEYS, ScoreFactorKey } from "@/lib/types";
import { BiasThreshold, DEFAULT_BIAS_THRESHOLDS } from "@/lib/config";

export type AdminActionState = { error: string; success?: undefined } | { success: string; error?: undefined } | undefined;

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

/** Same 5 bias labels, same order, as DEFAULT_BIAS_THRESHOLDS — the last
 * ("Very Bearish") stays -Infinity by convention (the catch-all floor, not
 * a user-editable number; see AdminClient.tsx, which disables that row's
 * input for the same reason). Requires the 4 editable thresholds to stay
 * in strictly descending order — a scrambled ladder would make
 * classifyBias's first-match-wins scan silently pick the wrong label. */
function parseBiasThresholds(formData: FormData): { biasThresholds: BiasThreshold[] } | { error: string } {
  const biasThresholds: BiasThreshold[] = [];
  for (let i = 0; i < DEFAULT_BIAS_THRESHOLDS.length; i++) {
    const bias = DEFAULT_BIAS_THRESHOLDS[i].bias;
    if (DEFAULT_BIAS_THRESHOLDS[i].min === -Infinity) {
      biasThresholds.push({ bias, min: -Infinity });
      continue;
    }
    const raw = formData.get(`threshold:${i}`);
    const value = Number(raw);
    if (raw === null || !Number.isFinite(value)) return { error: `Invalid bias threshold for ${bias}.` };
    biasThresholds.push({ bias, min: value });
  }
  for (let i = 0; i < biasThresholds.length - 2; i++) {
    if (biasThresholds[i].min <= biasThresholds[i + 1].min) {
      return { error: `Bias thresholds must strictly decrease from ${biasThresholds[i].bias} to ${biasThresholds[i + 1].bias}.` };
    }
  }
  return { biasThresholds };
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

  const configRow = await createScoringConfiguration({
    weights: weightsResult.weights,
    biasThresholds: thresholdsResult.biasThresholds,
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
      symbols.map((symbol) => computeLiveMarketScore(symbol, DATA_MODE, { storageOnly: true, updateCurrent: true, scoringConfig }))
    );
    recomputed = results.filter((r) => r.status === "fulfilled").length;
    failed = results.filter((r) => r.status === "rejected").length;
  }

  revalidateCanonicalScoreViews();

  return {
    success: isDemoOnly()
      ? `Scoring configuration v${configRow.id} saved and activated.`
      : `Scoring configuration v${configRow.id} saved and activated — recomputed ${recomputed}/${recomputed + failed} strict-live markets.`,
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
    symbols.map((symbol) => computeLiveMarketScore(symbol, DATA_MODE, { storageOnly: true, updateCurrent: true, scoringConfig }))
  );
  const recomputed = results.filter((r) => r.status === "fulfilled").length;

  revalidateCanonicalScoreViews();

  return { success: `Recalculated ${recomputed}/${symbols.length} strict-live markets from stored factor data.` };
}
