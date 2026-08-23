// Regression coverage for the real Admin "Save & Version" behavior: it
// used to be pure client-side React state (see AdminClient.tsx's git
// history) that never validated anything or touched Neon. This proves the
// real server action validates weights/thresholds, persists a new active
// scoring configuration, recomputes every strict-live market from already
// -stored factor data (storageOnly:true — never a live provider call),
// and refuses to save an invalid configuration at all.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/dal");
vi.mock("@/db/queries/scoring-config");
vi.mock("@/lib/pipeline/scoring-engine");
vi.mock("@/lib/scoring-v2/engine");
vi.mock("@/services/data-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/data-mode")>();
  return { ...actual, isDemoOnly: vi.fn(() => false), strictLiveSymbolList: vi.fn(() => ["GBPUSD", "EURUSD", "BTCUSD"]) };
});

import { requireAdmin } from "@/lib/auth/dal";
import { createScoringConfiguration } from "@/db/queries/scoring-config";
import { computeLiveMarketScore } from "@/lib/pipeline/scoring-engine";
import { computeMarketScoreV2 } from "@/lib/scoring-v2/engine";
import { isDemoOnly, strictLiveSymbolList } from "@/services/data-mode";
import { saveScoringConfiguration, recomputeAllScores, recomputeScoresV2Now } from "./admin";
import { SCORE_FACTOR_KEYS } from "@/lib/types";
import { DEFAULT_FACTOR_WEIGHTS, DEFAULT_BIAS_THRESHOLDS } from "@/lib/config";
import { DEFAULT_SCORING_V2_SETTINGS } from "@/lib/scoring-v2/config";
import type { User } from "@/db/queries/users";

const ADMIN_USER: User = { id: 1, email: "samkouifi991@gmail.com", passwordHash: "x", name: null, createdAt: new Date() };

function weightsFormData(weights: Record<string, number> = DEFAULT_FACTOR_WEIGHTS): FormData {
  const fd = new FormData();
  for (const key of SCORE_FACTOR_KEYS) fd.set(`weight:${key}`, String(weights[key]));
  DEFAULT_BIAS_THRESHOLDS.forEach((t, i) => {
    if (t.min !== -Infinity) fd.set(`threshold:${i}`, String(t.min));
  });
  return fd;
}

describe("saveScoringConfiguration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN_USER);
    vi.mocked(isDemoOnly).mockReturnValue(false);
    vi.mocked(strictLiveSymbolList).mockReturnValue(["GBPUSD", "EURUSD", "BTCUSD"]);
    vi.mocked(createScoringConfiguration).mockResolvedValue({
      id: 5,
      weights: DEFAULT_FACTOR_WEIGHTS,
      biasThresholds: DEFAULT_BIAS_THRESHOLDS,
      v2Settings: null,
      createdBy: ADMIN_USER.email,
      createdAt: new Date(),
    });
    vi.mocked(computeLiveMarketScore).mockResolvedValue({
      symbol: "x", totalScore: 0, bias: "Neutral", confidence: 50, change24h: 0, factors: [], history: [], lastUpdated: new Date().toISOString(),
    });
  });

  it("rejects weights that don't sum to exactly 100%, and never persists or recomputes", async () => {
    const badWeights = { ...DEFAULT_FACTOR_WEIGHTS, technical: 0.5 }; // now sums to 1.3
    const result = await saveScoringConfiguration(undefined, weightsFormData(badWeights));

    expect(result?.error).toMatch(/sum to exactly 100%/i);
    expect(createScoringConfiguration).not.toHaveBeenCalled();
    expect(computeLiveMarketScore).not.toHaveBeenCalled();
  });

  it("rejects bias thresholds that aren't strictly descending", async () => {
    const fd = weightsFormData();
    fd.set("threshold:1", "10"); // Bullish=10, higher than Very Bullish's fixed 8 — scrambled ladder
    const result = await saveScoringConfiguration(undefined, fd);

    expect(result?.error).toMatch(/strictly decrease/i);
    expect(createScoringConfiguration).not.toHaveBeenCalled();
  });

  it("accepts an edited Very Bearish threshold, saving it like any other editable threshold", async () => {
    const fd = weightsFormData();
    fd.set("threshold:4", "-8.5"); // Very Bearish: -10 -> -8.5, still below Bearish's -7.9
    const result = await saveScoringConfiguration(undefined, fd);

    expect(createScoringConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ biasThresholds: expect.arrayContaining([{ bias: "Very Bearish", min: -8.5 }]) })
    );
    expect(result?.success).toMatch(/configuration saved — v5 active/i);
  });

  it("rejects a Very Bearish threshold that isn't strictly below Bearish", async () => {
    const fd = weightsFormData();
    fd.set("threshold:4", "-7.9"); // equal to Bearish's -7.9 — not strictly less
    const result = await saveScoringConfiguration(undefined, fd);

    expect(result?.error).toMatch(/strictly decrease/i);
    expect(createScoringConfiguration).not.toHaveBeenCalled();
  });

  it("persists a new active configuration and recomputes every strict-live market with storageOnly:true — never a live provider call", async () => {
    const result = await saveScoringConfiguration(undefined, weightsFormData());

    expect(createScoringConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ weights: DEFAULT_FACTOR_WEIGHTS, createdBy: ADMIN_USER.email })
    );
    expect(computeLiveMarketScore).toHaveBeenCalledTimes(3);
    for (const [symbol, , options] of vi.mocked(computeLiveMarketScore).mock.calls) {
      expect(["GBPUSD", "EURUSD", "BTCUSD"]).toContain(symbol);
      expect(options).toMatchObject({ storageOnly: true, updateCurrent: true, awaitPersist: true, scoringConfig: { id: 5 } });
    }
    expect(result?.success).toMatch(/configuration saved — v5 active/i);
    if (!result || "error" in result) throw new Error("expected a success result");
    expect(result.versionId).toBe(5);
    expect(result.updatedAt).toBeDefined();
  });

  it("skips recomputation entirely in demo mode — there is no live pipeline to touch", async () => {
    vi.mocked(isDemoOnly).mockReturnValue(true);
    const result = await saveScoringConfiguration(undefined, weightsFormData());

    expect(createScoringConfiguration).toHaveBeenCalled();
    expect(computeLiveMarketScore).not.toHaveBeenCalled();
    expect(result?.success).toMatch(/configuration saved — v5 active/i);
  });

  it("saves the complete Scoring V2 config in the same request when v2:* fields are submitted (one Save & Version for the whole model)", async () => {
    const fd = weightsFormData();
    fd.set("v2:eventShockMax", "4");
    fd.set("v2:decayHigh", "48");
    fd.set("v2:decayMedium", "12");
    fd.set("v2:decayLow", "3");
    fd.set("v2:minConfidenceForExtreme", "65");
    fd.set("v2:smoothingAlpha", "0.6");
    fd.set("v2:smoothingAlphaHighImpact", "0.9");
    fd.set("v2:hysteresis:veryBullish:enter", "8");
    fd.set("v2:hysteresis:veryBullish:exit", "6.5");
    fd.set("v2:hysteresis:bullish:enter", "4");
    fd.set("v2:hysteresis:bullish:exit", "3");
    fd.set("v2:hysteresis:bearish:enter", "-4");
    fd.set("v2:hysteresis:bearish:exit", "-3");
    fd.set("v2:hysteresis:veryBearish:enter", "-8");
    fd.set("v2:hysteresis:veryBearish:exit", "-6.5");
    fd.set("v2:familyCap:macro", "6");
    fd.set("v2:familyCap:positioning", "4");
    fd.set("v2:familyCap:technical", "4");
    fd.set("v2:familyCap:event", "3");

    await saveScoringConfiguration(undefined, fd);

    expect(createScoringConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        v2Settings: expect.objectContaining({
          eventShock: { maxContribution: 4, decayHalfLifeHoursByTier: { HIGH: 48, MEDIUM: 12, LOW: 3 } },
          minConfidenceForExtreme: 65,
          smoothingAlpha: 0.6,
          smoothingAlphaHighImpact: 0.9,
        }),
      })
    );
  });

  it("falls back to DEFAULT_SCORING_V2_SETTINGS field-by-field when no v2:* fields are submitted at all (pre-V2 form compatibility)", async () => {
    await saveScoringConfiguration(undefined, weightsFormData());

    expect(createScoringConfiguration).toHaveBeenCalledWith(expect.objectContaining({ v2Settings: DEFAULT_SCORING_V2_SETTINGS }));
  });

  it("rejects a hysteresis exit threshold on the wrong side of its own entry threshold", async () => {
    const fd = weightsFormData();
    fd.set("v2:hysteresis:bullish:enter", "4");
    fd.set("v2:hysteresis:bullish:exit", "5"); // exit above entry — the band could never hold anything

    const result = await saveScoringConfiguration(undefined, fd);

    expect(result?.error).toMatch(/exit threshold/i);
    expect(createScoringConfiguration).not.toHaveBeenCalled();
  });

  it("rejects a minimum confidence for extreme labels outside [0, 100]", async () => {
    const fd = weightsFormData();
    fd.set("v2:minConfidenceForExtreme", "150");

    const result = await saveScoringConfiguration(undefined, fd);

    expect(result?.error).toMatch(/between 0 and 100/i);
    expect(createScoringConfiguration).not.toHaveBeenCalled();
  });
});

describe("recomputeScoresV2Now", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN_USER);
    vi.mocked(isDemoOnly).mockReturnValue(false);
    vi.mocked(strictLiveSymbolList).mockReturnValue(["GBPUSD", "EURUSD", "BTCUSD"]);
    vi.mocked(computeMarketScoreV2).mockResolvedValue({
      symbol: "x", totalScore: 0, rawScore: 0, bias: "Neutral", confidence: 50, change24h: 0, factors: [], history: [], lastUpdated: new Date().toISOString(),
    });
  });

  it("recomputes every strict-live market's V2 shadow score with storageOnly:true and persist:true", async () => {
    const result = await recomputeScoresV2Now();

    expect(computeMarketScoreV2).toHaveBeenCalledTimes(3);
    for (const [symbol, , options] of vi.mocked(computeMarketScoreV2).mock.calls) {
      expect(["GBPUSD", "EURUSD", "BTCUSD"]).toContain(symbol);
      expect(options).toMatchObject({ storageOnly: true, persist: true });
    }
    expect(result?.success).toMatch(/scoring engine v2.*recalculated 3\/3/i);
  });

  it("skips recomputation entirely in demo mode", async () => {
    vi.mocked(isDemoOnly).mockReturnValue(true);
    const result = await recomputeScoresV2Now();

    expect(computeMarketScoreV2).not.toHaveBeenCalled();
    expect(result?.success).toMatch(/demo mode/i);
  });
});

describe("recomputeAllScores", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN_USER);
    vi.mocked(isDemoOnly).mockReturnValue(false);
    vi.mocked(strictLiveSymbolList).mockReturnValue(["GBPUSD", "EURUSD", "BTCUSD"]);
    vi.mocked(computeLiveMarketScore).mockResolvedValue({
      symbol: "x", totalScore: 0, bias: "Neutral", confidence: 50, change24h: 0, factors: [], history: [], lastUpdated: new Date().toISOString(),
    });
  });

  it("recomputes every strict-live market from stored data only, without saving a new configuration version", async () => {
    const result = await recomputeAllScores();

    expect(createScoringConfiguration).not.toHaveBeenCalled();
    expect(computeLiveMarketScore).toHaveBeenCalledTimes(3);
    for (const [, , options] of vi.mocked(computeLiveMarketScore).mock.calls) {
      expect(options).toMatchObject({ storageOnly: true, updateCurrent: true, awaitPersist: true });
    }
    expect(result?.success).toMatch(/recalculated 3\/3/i);
  });
});
