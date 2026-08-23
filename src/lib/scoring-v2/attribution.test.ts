import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/db/queries/scoring-v2");

import { getRecentFactorScoreV2Snapshots } from "@/db/queries/scoring-v2";
import { computeScoreChangeAttribution } from "./attribution";
import { ScoreFactor } from "@/lib/types";

function factor(key: ScoreFactor["key"] | "event" | "smoothing", contribution: number, explanation = "test"): ScoreFactor {
  return { key: key as ScoreFactor["key"], contribution, rawScore: contribution, weight: 1, explanation, source: "test", provider: "test", freshness: "live", lastUpdated: "", nextUpdate: "" };
}

describe("computeScoreChangeAttribution", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns null when fewer than two real snapshots exist yet — never fabricates a change", async () => {
    vi.mocked(getRecentFactorScoreV2Snapshots).mockResolvedValue([{ computedAt: "t2", factors: [factor("inflation", 1)] }]);
    expect(await computeScoreChangeAttribution("XAUUSD")).toBeNull();
  });

  it("builds the exact +2.1 -> +5.4 style breakdown from real stored per-factor deltas", async () => {
    vi.mocked(getRecentFactorScoreV2Snapshots).mockResolvedValue([
      { computedAt: "t2", factors: [factor("inflation", 1.4, "CPI came in below consensus"), factor("interestRates", 0.5, "Real yields fell"), factor("technical", 0.9)] },
      { computedAt: "t1", factors: [factor("inflation", 0.2), factor("interestRates", -0.4), factor("technical", 0.5)] },
    ]);

    const result = await computeScoreChangeAttribution("XAUUSD");
    expect(result).not.toBeNull();
    expect(result!.fromComputedAt).toBe("t1");
    expect(result!.toComputedAt).toBe("t2");

    const inflationItem = result!.items.find((i) => i.key === "inflation");
    expect(inflationItem!.delta).toBeCloseTo(1.2, 4);
    expect(inflationItem!.explanation).toBe("CPI came in below consensus"); // the real, already-stored explanation — never LLM invention

    const ratesItem = result!.items.find((i) => i.key === "interestRates");
    expect(ratesItem!.delta).toBeCloseTo(0.9, 4);
  });

  it("sorts items by the magnitude of their change, largest first", async () => {
    vi.mocked(getRecentFactorScoreV2Snapshots).mockResolvedValue([
      { computedAt: "t2", factors: [factor("inflation", 2), factor("technical", 0.3)] },
      { computedAt: "t1", factors: [factor("inflation", 0), factor("technical", 0)] },
    ]);
    const result = await computeScoreChangeAttribution("XAUUSD");
    expect(result!.items[0].key).toBe("inflation");
    expect(result!.items[1].key).toBe("technical");
  });

  it("omits a factor whose contribution barely moved (negligible/no-op change)", async () => {
    vi.mocked(getRecentFactorScoreV2Snapshots).mockResolvedValue([
      { computedAt: "t2", factors: [factor("inflation", 1.001), factor("technical", 0.9)] },
      { computedAt: "t1", factors: [factor("inflation", 1.0), factor("technical", 0.1)] },
    ]);
    const result = await computeScoreChangeAttribution("XAUUSD");
    expect(result!.items.some((i) => i.key === "inflation")).toBe(false);
    expect(result!.items.some((i) => i.key === "technical")).toBe(true);
  });

  it("labels V2's pseudo-factors (event, smoothing) with real human-readable names", async () => {
    vi.mocked(getRecentFactorScoreV2Snapshots).mockResolvedValue([
      { computedAt: "t2", factors: [factor("event", 1.5, "CPI surprise shock")] },
      { computedAt: "t1", factors: [factor("event", 0)] },
    ]);
    const result = await computeScoreChangeAttribution("XAUUSD");
    expect(result!.items[0].label).toBe("Economic-release event shock");
  });

  it("computes fromTotal/toTotal/netChange from the real summed contributions", async () => {
    vi.mocked(getRecentFactorScoreV2Snapshots).mockResolvedValue([
      { computedAt: "t2", factors: [factor("inflation", 3), factor("technical", 2.4)] },
      { computedAt: "t1", factors: [factor("inflation", 1), factor("technical", 1.1)] },
    ]);
    const result = await computeScoreChangeAttribution("XAUUSD");
    expect(result!.fromTotal).toBeCloseTo(2.1, 4);
    expect(result!.toTotal).toBeCloseTo(5.4, 4);
    expect(result!.netChange).toBeCloseTo(3.3, 4);
  });
});
