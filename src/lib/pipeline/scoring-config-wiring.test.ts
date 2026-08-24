// Regression test for the Admin-weights-don't-affect-scores bug: Admin's
// Save & Version used to be pure client-side React state that never
// touched Neon, so computeLiveMarketScore always used the hardcoded
// DEFAULT_FACTOR_WEIGHTS/DEFAULT_BIAS_THRESHOLDS no matter what the Admin
// UI showed (e.g. Admin said Retail 5%, BTCUSD still showed 10%).
//
// This proves computeLiveMarketScore actually uses the scoringConfig it's
// given: the same underlying factor data (mocked resolvers, fixed raw
// scores) produces a DIFFERENT weighted contribution and total score when
// the config's weights change, an unchanged raw score either way, and a
// different bias label when the config's thresholds change — exactly the
// "changing a weight changes the weighted contribution, not the raw
// score" distinction the task calls out.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ResolvedFactor } from "./types";

vi.mock("./technical");
vi.mock("./seasonality");
vi.mock("./positioning");
vi.mock("./sentiment");
vi.mock("./macro");
vi.mock("./news");
vi.mock("@/db/queries/scores");

import { resolveTechnicalFactor } from "./technical";
import { resolveSeasonalityFactor } from "./seasonality";
import { resolveInstitutionalFactor } from "./positioning";
import { resolveRetailSentimentFactor } from "./sentiment";
import { resolveEconomicGrowthFactor, resolveInflationFactor, resolveLaborFactor, resolveInterestRatesFactor } from "./macro";
import { resolveNewsFactor } from "./news";
import { recordScoreHistory, getScoreHistory, upsertCurrentScore } from "@/db/queries/scores";
import { computeLiveMarketScore } from "./scoring-engine";
import { ResolvedScoringConfig } from "./scoring-config";
import { DEFAULT_FACTOR_WEIGHTS } from "@/lib/config";

function factor(key: ResolvedFactor["key"], rawScore: number): ResolvedFactor {
  const now = new Date().toISOString();
  return { key, rawScore, explanation: "test", source: "test", provider: "test", freshness: "live", lastUpdated: now, nextUpdate: now };
}

// institutional=+2, technical=+8, everything else exactly 0 (matching the
// task's own "BTCUSD Retail Sentiment rawScore=0" example) — keeps the
// expected math trivial to hand-verify.
function mockResolvers() {
  vi.mocked(resolveInstitutionalFactor).mockResolvedValue(factor("institutional", 2));
  vi.mocked(resolveTechnicalFactor).mockResolvedValue(factor("technical", 8));
  vi.mocked(resolveRetailSentimentFactor).mockResolvedValue(factor("retailSentiment", 0));
  vi.mocked(resolveSeasonalityFactor).mockResolvedValue(factor("seasonality", 0));
  vi.mocked(resolveEconomicGrowthFactor).mockResolvedValue(factor("economicGrowth", 0));
  vi.mocked(resolveInflationFactor).mockResolvedValue(factor("inflation", 0));
  vi.mocked(resolveLaborFactor).mockResolvedValue(factor("labor", 0));
  vi.mocked(resolveInterestRatesFactor).mockResolvedValue(factor("interestRates", 0));
  vi.mocked(resolveNewsFactor).mockResolvedValue(factor("news", 0));
}

// CONFIG_A: the plain defaults. CONFIG_B: moves 10 points from
// institutional to technical (0.15->0.05, 0.20->0.30) and lowers the
// Bullish bias threshold from 4 to 2 — deliberately exercising both a
// weight change and a threshold change in one config, like a real admin
// edit touching both cards before saving.
const CONFIG_A: ResolvedScoringConfig = { id: 1, weights: DEFAULT_FACTOR_WEIGHTS, biasThresholds: [
  { bias: "Very Bullish", min: 8 },
  { bias: "Bullish", min: 4 },
  { bias: "Neutral", min: -3.9 },
  { bias: "Bearish", min: -7.9 },
  { bias: "Very Bearish", min: -Infinity },
] };

const CONFIG_B: ResolvedScoringConfig = {
  id: 2,
  weights: { ...DEFAULT_FACTOR_WEIGHTS, institutional: 0.05, technical: 0.3 },
  biasThresholds: [
    { bias: "Very Bullish", min: 8 },
    { bias: "Bullish", min: 2 },
    { bias: "Neutral", min: -3.9 },
    { bias: "Bearish", min: -7.9 },
    { bias: "Very Bearish", min: -Infinity },
  ],
};

describe("computeLiveMarketScore uses the scoringConfig it's given, not hardcoded defaults", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolvers();
    vi.mocked(getScoreHistory).mockResolvedValue([]);
    vi.mocked(recordScoreHistory).mockResolvedValue(undefined);
    vi.mocked(upsertCurrentScore).mockResolvedValue(undefined);
  });

  it("keeps every raw factor score identical across a weight change", async () => {
    const scoreA = await computeLiveMarketScore("BTCUSD", "live", { storageOnly: true, scoringConfig: CONFIG_A });
    const scoreB = await computeLiveMarketScore("BTCUSD", "live", { storageOnly: true, scoringConfig: CONFIG_B });

    for (const key of ["institutional", "technical", "retailSentiment"] as const) {
      const rawA = scoreA.factors.find((f) => f.key === key)!.rawScore;
      const rawB = scoreB.factors.find((f) => f.key === key)!.rawScore;
      expect(rawB, `${key} rawScore must not change with the config`).toBe(rawA);
    }
  });

  it("recomputes weight and contribution from the new config's weights", async () => {
    const scoreA = await computeLiveMarketScore("BTCUSD", "live", { storageOnly: true, scoringConfig: CONFIG_A });
    const scoreB = await computeLiveMarketScore("BTCUSD", "live", { storageOnly: true, scoringConfig: CONFIG_B });

    const techA = scoreA.factors.find((f) => f.key === "technical")!;
    const techB = scoreB.factors.find((f) => f.key === "technical")!;
    expect(techA.weight).toBe(0.2);
    expect(techB.weight).toBe(0.3);
    expect(techA.contribution).toBe(1.6); // 8 * 0.20
    expect(techB.contribution).toBe(2.4); // 8 * 0.30

    const instA = scoreA.factors.find((f) => f.key === "institutional")!;
    const instB = scoreB.factors.find((f) => f.key === "institutional")!;
    expect(instA.contribution).toBe(0.3); // 2 * 0.15
    expect(instB.contribution).toBe(0.1); // 2 * 0.05

    // The task's own example: a zero raw score produces zero contribution
    // regardless of weight — the *displayed weight* must still change.
    const retailA = scoreA.factors.find((f) => f.key === "retailSentiment")!;
    expect(retailA.weight).toBe(0.1);
    expect(retailA.contribution).toBe(0);
  });

  it("changes the Total Score mathematically, and Total Score always equals the sum of visible contributions", async () => {
    const scoreA = await computeLiveMarketScore("BTCUSD", "live", { storageOnly: true, scoringConfig: CONFIG_A });
    const scoreB = await computeLiveMarketScore("BTCUSD", "live", { storageOnly: true, scoringConfig: CONFIG_B });

    expect(scoreA.totalScore).toBe(1.9); // 2*0.15 + 8*0.20
    expect(scoreB.totalScore).toBe(2.5); // 2*0.05 + 8*0.30

    for (const score of [scoreA, scoreB]) {
      const sum = Number(score.factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
      expect(sum, "Total Score must equal Σ visible weighted contributions").toBe(score.totalScore);
    }
  });

  it("recalculates bias from the config's own bias thresholds, not a hardcoded default", async () => {
    const scoreA = await computeLiveMarketScore("BTCUSD", "live", { storageOnly: true, scoringConfig: CONFIG_A });
    const scoreB = await computeLiveMarketScore("BTCUSD", "live", { storageOnly: true, scoringConfig: CONFIG_B });

    expect(scoreA.bias).toBe("Neutral"); // 1.9 < Bullish threshold of 4
    expect(scoreB.bias).toBe("Bullish"); // 2.5 >= Bullish threshold of 2 (lowered in CONFIG_B)
  });

  it("persists the scoring-version id that produced each current-score row", async () => {
    await computeLiveMarketScore("BTCUSD", "live", { storageOnly: true, updateCurrent: true, scoringConfig: CONFIG_B });
    expect(upsertCurrentScore).toHaveBeenCalledWith(expect.objectContaining({ totalScore: 2.5 }), 2);
  });

  // Regression: computeLiveMarketScore used to fire upsertCurrentScore
  // without awaiting it, so a caller (like the Admin recompute action)
  // could resolve — and a serverless invocation could be frozen — before
  // the write actually landed. A read immediately after would race the
  // write and could observe the OLD row, exactly like the bug report
  // (Admin's saved weights not reflected in current_factor_scores). This
  // proves awaitPersist:true genuinely blocks until the write settles.
  it("awaitPersist:true blocks until upsertCurrentScore's write has actually completed", async () => {
    let resolveWrite!: () => void;
    const pendingWrite = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    vi.mocked(upsertCurrentScore).mockReturnValue(pendingWrite);

    let settled = false;
    const call = computeLiveMarketScore("BTCUSD", "live", { storageOnly: true, updateCurrent: true, scoringConfig: CONFIG_B, awaitPersist: true }).then(
      () => {
        settled = true;
      }
    );

    await Promise.resolve(); // let microtasks up to the pending write run
    expect(settled).toBe(false); // must not have resolved while the write is still in flight

    resolveWrite();
    await call;
    expect(settled).toBe(true);
  });
});
