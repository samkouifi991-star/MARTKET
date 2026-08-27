import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/db/queries/market-data");

import { getHighGeopoliticalRelevanceNews, StoredNewsArticle } from "@/db/queries/market-data";
import { buildGeopoliticalRisk } from "./geopolitical-risk";

const NOW = new Date("2027-01-15T12:00:00.000Z");

function article(overrides: Partial<StoredNewsArticle> & { publishedAt: string }): StoredNewsArticle {
  return {
    id: 1,
    headline: "Test headline",
    source: "Forex Factory email",
    url: null,
    affectedMarkets: ["EURUSD"],
    interpretation: "Bearish",
    importance: 80,
    confidence: 80,
    reason: "test",
    geopoliticalRelevance: 80,
    monetaryPolicyRelevance: 0,
    riskSentiment: "RiskOff",
    riskCategory: "war",
    classifierModel: "claude-opus-5",
    ...overrides,
  };
}

describe("buildGeopoliticalRisk", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns LOW with zero score when there are no qualifying articles", async () => {
    vi.mocked(getHighGeopoliticalRelevanceNews).mockResolvedValue([]);
    const data = await buildGeopoliticalRisk(NOW);
    expect(data.level).toBe("LOW");
    expect(data.score).toBe(0);
    expect(data.events).toEqual([]);
  });

  it("weights a fresh, high-importance, high-relevance war headline into HIGH/CRITICAL", async () => {
    vi.mocked(getHighGeopoliticalRelevanceNews).mockResolvedValue([
      article({ publishedAt: NOW.toISOString(), importance: 95, geopoliticalRelevance: 95, riskCategory: "war" }),
    ]);
    const data = await buildGeopoliticalRisk(NOW);
    expect(data.score).toBeGreaterThan(0);
    expect(["HIGH", "CRITICAL"]).toContain(data.level);
    expect(data.subScores.safeHaven).toBeGreaterThan(0);
  });

  it("decays an old headline's contribution toward zero", async () => {
    vi.mocked(getHighGeopoliticalRelevanceNews).mockResolvedValue([
      article({ publishedAt: new Date(NOW.getTime() - 200 * 24 * 3_600_000).toISOString(), importance: 95, geopoliticalRelevance: 95 }),
    ]);
    const data = await buildGeopoliticalRisk(NOW);
    expect(data.score).toBe(0);
    expect(data.level).toBe("LOW");
  });

  it("routes riskCategory into the correct sub-score bucket", async () => {
    vi.mocked(getHighGeopoliticalRelevanceNews).mockResolvedValue([
      article({ id: 1, publishedAt: NOW.toISOString(), riskCategory: "energy", importance: 80, geopoliticalRelevance: 80 }),
      article({ id: 2, publishedAt: NOW.toISOString(), riskCategory: "tariffs", importance: 80, geopoliticalRelevance: 80 }),
      article({ id: 3, publishedAt: NOW.toISOString(), riskCategory: "central_bank", importance: 80, monetaryPolicyRelevance: 80, geopoliticalRelevance: 0 }),
      article({ id: 4, publishedAt: NOW.toISOString(), riskCategory: "other", importance: 80, geopoliticalRelevance: 80 }),
    ]);
    const data = await buildGeopoliticalRisk(NOW);
    expect(data.subScores.energy).toBeGreaterThan(0);
    expect(data.subScores.tradeTariff).toBeGreaterThan(0);
    expect(data.subScores.monetaryPolicy).toBeGreaterThan(0);
    // "other" contributes to the aggregate score but no named sub-score.
    expect(data.score).toBeGreaterThan(data.subScores.energy + data.subScores.tradeTariff + data.subScores.monetaryPolicy);
  });

  it("derives region from affectedMarkets' currencies, not a stored field", async () => {
    vi.mocked(getHighGeopoliticalRelevanceNews).mockResolvedValue([article({ publishedAt: NOW.toISOString(), affectedMarkets: ["GBPUSD"] })]);
    const data = await buildGeopoliticalRisk(NOW);
    expect(["GB", "US", "Multi-region"]).toContain(data.events[0].region);
  });

  it("falls back to Global region when affectedMarkets has no currency-bearing instrument", async () => {
    vi.mocked(getHighGeopoliticalRelevanceNews).mockResolvedValue([article({ publishedAt: NOW.toISOString(), affectedMarkets: [] })]);
    const data = await buildGeopoliticalRisk(NOW);
    expect(data.events[0].region).toBe("Global");
  });
});
