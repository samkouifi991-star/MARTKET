// "Why did the score change?" (requirement #21) — generated ENTIRELY from
// real stored per-factor contribution deltas between the two most recent
// V2 computation cycles (db/queries/scoring-v2.ts's
// getRecentFactorScoreV2Snapshots), each item carrying that factor's own
// real, already-stored explanation string. Never LLM-generated, and
// returns null (not a fabricated "nothing changed") when fewer than two
// real snapshots exist yet for this symbol.
import { getRecentFactorScoreV2Snapshots } from "@/db/queries/scoring-v2";
import { FACTOR_LABELS, ScoreFactorKey } from "@/lib/types";

export type AttributionItem = { key: string; label: string; delta: number; explanation: string };

export type AttributionResult = {
  symbol: string;
  fromComputedAt: string;
  toComputedAt: string;
  fromTotal: number;
  toTotal: number;
  netChange: number;
  items: AttributionItem[];
};

// V2's two pseudo-factors (event shocks, smoothing adjustment — see
// engine.ts) aren't in V1's FACTOR_LABELS, which only covers the 9 real
// ScoreFactorKeys.
const PSEUDO_FACTOR_LABELS: Record<string, string> = {
  event: "Economic-release event shock",
  smoothing: "Score smoothing adjustment",
};

function labelFor(key: string): string {
  return FACTOR_LABELS[key as ScoreFactorKey] ?? PSEUDO_FACTOR_LABELS[key] ?? key;
}

const NEGLIGIBLE_DELTA = 0.005;

export async function computeScoreChangeAttribution(symbol: string): Promise<AttributionResult | null> {
  const snapshots = await getRecentFactorScoreV2Snapshots(symbol, 2);
  if (snapshots.length < 2) return null; // not enough real history yet — never fabricated

  // getRecentFactorScoreV2Snapshots returns newest-first.
  const [latest, prior] = snapshots;
  const priorByKey = new Map(prior.factors.map((f) => [f.key, f]));

  const items: AttributionItem[] = latest.factors
    .map((f) => {
      const before = priorByKey.get(f.key);
      const delta = Number((f.contribution - (before?.contribution ?? 0)).toFixed(2));
      return { key: f.key, label: labelFor(f.key), delta, explanation: f.explanation };
    })
    .filter((item) => Math.abs(item.delta) > NEGLIGIBLE_DELTA)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const fromTotal = Number(prior.factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
  const toTotal = Number(latest.factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));

  return {
    symbol,
    fromComputedAt: prior.computedAt,
    toComputedAt: latest.computedAt,
    fromTotal,
    toTotal,
    netChange: Number((toTotal - fromTotal).toFixed(2)),
    items,
  };
}
