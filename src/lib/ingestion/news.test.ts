import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/db/queries/market-data");
vi.mock("@/db/queries/zapier-ingest-log");
vi.mock("@/db/queries/economic-releases");
vi.mock("@/lib/engines/llm-news-classifier");
vi.mock("@/lib/scoring-v2/recompute");

import { insertNewsArticleFromZapier, updateNewsArticleClassification } from "@/db/queries/market-data";
import { logZapierIngest } from "@/db/queries/zapier-ingest-log";
import { recordEventShock } from "@/db/queries/economic-releases";
import { classifyNewsWithLLM } from "@/lib/engines/llm-news-classifier";
import { recomputeSymbols } from "@/lib/scoring-v2/recompute";
import { ingestNews } from "./news";
import { NewsPayload } from "@/app/api/integrations/zapier/market-event/schema";

const payload: NewsPayload = {
  type: "news",
  source: "forex_factory_email",
  headline: "Fed signals rates may remain higher for longer",
  summary: "The Fed hinted at extended tightening.",
  currencies: ["USD"],
  impact: "High",
  publishedAt: "2027-01-15T13:30:00.000Z",
  sourceUrl: null,
};

describe("ingestNews (canonical ingestion, both channels)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(insertNewsArticleFromZapier).mockResolvedValue(7);
    vi.mocked(updateNewsArticleClassification).mockResolvedValue(undefined);
    vi.mocked(recordEventShock).mockResolvedValue(undefined);
    vi.mocked(recomputeSymbols).mockResolvedValue(["EURUSD"]);
    vi.mocked(logZapierIngest).mockResolvedValue(undefined);
    vi.mocked(classifyNewsWithLLM).mockResolvedValue({
      affectedMarkets: ["EURUSD"],
      interpretation: "Bullish",
      importance: 80,
      confidence: 80,
      geopoliticalRelevance: 10,
      monetaryPolicyRelevance: 80,
      riskSentiment: "RiskOff",
      reason: "Fed hinted at tightening per headline.",
      model: "claude-opus-5",
    });
  });

  it("dry run classifies but writes nothing", async () => {
    const result = await ingestNews(payload, { channel: "manual", dryRun: true, rawPayload: payload });
    expect(result.dryRun).toBe(true);
    expect(insertNewsArticleFromZapier).not.toHaveBeenCalled();
    expect(classifyNewsWithLLM).toHaveBeenCalled();
  });

  it("manual channel writes provider 'manual-admin' and logs channel 'manual'", async () => {
    const result = await ingestNews(payload, { channel: "manual", dryRun: false, rawPayload: payload });
    expect(result.dryRun).toBe(false);
    expect(insertNewsArticleFromZapier).toHaveBeenCalledWith(expect.objectContaining({ provider: "manual-admin" }));
    expect(logZapierIngest).toHaveBeenCalledWith(expect.objectContaining({ channel: "manual", outcome: "accepted_new" }));
    if (!result.dryRun && !result.duplicate) expect(result.recomputedMarkets).toEqual(["EURUSD"]);
  });

  it("zapier channel writes provider 'zapier-forexfactory'", async () => {
    await ingestNews(payload, { channel: "zapier", dryRun: false, rawPayload: payload });
    expect(insertNewsArticleFromZapier).toHaveBeenCalledWith(expect.objectContaining({ provider: "zapier-forexfactory" }));
    expect(logZapierIngest).toHaveBeenCalledWith(expect.objectContaining({ channel: "zapier" }));
  });

  it("skips classification entirely for a duplicate delivery", async () => {
    vi.mocked(insertNewsArticleFromZapier).mockResolvedValue(null);
    const result = await ingestNews(payload, { channel: "zapier", dryRun: false, rawPayload: payload });
    expect(result.dryRun).toBe(false);
    if (!result.dryRun) expect(result.duplicate).toBe(true);
    expect(classifyNewsWithLLM).not.toHaveBeenCalled();
    expect(logZapierIngest).toHaveBeenCalledWith(expect.objectContaining({ outcome: "accepted_duplicate" }));
  });

  it("never records a shock for low-relevance news", async () => {
    vi.mocked(classifyNewsWithLLM).mockResolvedValue({
      affectedMarkets: ["EURUSD"],
      interpretation: "Bullish",
      importance: 50,
      confidence: 50,
      geopoliticalRelevance: 5,
      monetaryPolicyRelevance: 5,
      riskSentiment: "Neutral",
      reason: "Low relevance",
      model: "claude-opus-5",
    });
    await ingestNews(payload, { channel: "manual", dryRun: false, rawPayload: payload });
    expect(recordEventShock).not.toHaveBeenCalled();
  });
});
