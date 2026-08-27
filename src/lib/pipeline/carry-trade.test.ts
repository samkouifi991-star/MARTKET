import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./forex-scorecard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./forex-scorecard")>();
  return { ...actual, buildAllForexScorecards: vi.fn() };
});

import { buildAllForexScorecards } from "./forex-scorecard";
import { buildCarryTradeScanner, rowFromScorecard } from "./carry-trade";
import type { ForexScorecardData } from "./forex-scorecard";

function scorecard(overrides: Partial<ForexScorecardData>): ForexScorecardData {
  return {
    symbol: "GBPJPY",
    base: "GBP",
    quote: "JPY",
    baseStrength: { currency: "GBP", country: "GB", score: null, level: null, drivers: [], freshness: "live" },
    quoteStrength: { currency: "JPY", country: "JP", score: null, level: null, drivers: [], freshness: "live" },
    strengthDifferential: null,
    baseRate: null,
    quoteRate: null,
    rateDifferentialPts: null,
    surpriseDifferential: null,
    dailyTrend: null,
    h4Trend: null,
    h1Trend: null,
    technicalFreshness: null,
    retail: null,
    finalScore: null,
    finalBias: null,
    ...overrides,
  };
}

describe("rowFromScorecard", () => {
  it("classifies a positive rate differential as Long base, supported when strength agrees", () => {
    const row = rowFromScorecard(scorecard({ rateDifferentialPts: 4.5, strengthDifferential: 30 }));
    expect(row.carryDirection).toBe("Long base");
    expect(row.support).toBe("Supported");
  });

  it("flags a carry fighting the trend when strength disagrees", () => {
    const row = rowFromScorecard(scorecard({ rateDifferentialPts: 4.5, strengthDifferential: -30 }));
    expect(row.carryDirection).toBe("Long base");
    expect(row.support).toBe("Fighting the trend");
  });

  it("classifies a negative rate differential as Long quote", () => {
    const row = rowFromScorecard(scorecard({ rateDifferentialPts: -3, strengthDifferential: -20 }));
    expect(row.carryDirection).toBe("Long quote");
    expect(row.support).toBe("Supported");
  });

  it("treats a near-zero differential as Flat with unknown support", () => {
    const row = rowFromScorecard(scorecard({ rateDifferentialPts: 0.02, strengthDifferential: 30 }));
    expect(row.carryDirection).toBe("Flat");
    expect(row.support).toBe("Unknown");
  });

  it("reports Unknown support when data is missing", () => {
    const row = rowFromScorecard(scorecard({ rateDifferentialPts: null, strengthDifferential: null }));
    expect(row.carryDirection).toBeNull();
    expect(row.support).toBe("Unknown");
  });

  it("reports Mixed when strength differential is too small to confirm or contradict", () => {
    const row = rowFromScorecard(scorecard({ rateDifferentialPts: 4.5, strengthDifferential: 2 }));
    expect(row.support).toBe("Mixed");
  });
});

describe("buildCarryTradeScanner", () => {
  beforeEach(() => vi.resetAllMocks());

  it("sorts by absolute rate differential, largest carry first", async () => {
    vi.mocked(buildAllForexScorecards).mockResolvedValue([
      scorecard({ symbol: "A", rateDifferentialPts: 1 }),
      scorecard({ symbol: "B", rateDifferentialPts: -5 }),
      scorecard({ symbol: "C", rateDifferentialPts: 3 }),
    ]);
    const rows = await buildCarryTradeScanner(true);
    expect(rows.map((r) => r.symbol)).toEqual(["B", "C", "A"]);
  });
});
