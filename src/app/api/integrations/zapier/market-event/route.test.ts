import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/scoring-v2/release-watch");
vi.mock("@/lib/scoring-v2/recompute");
vi.mock("@/db/queries/market-data");
vi.mock("@/db/queries/zapier-ingest-log");
vi.mock("@/db/queries/rate-limit");
vi.mock("@/db/queries/economic-releases");
vi.mock("@/lib/engines/llm-news-classifier");
vi.mock("../../../cron/_shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../cron/_shared")>();
  return { ...actual, isDemoMode: vi.fn(() => false) };
});

import { processReleases } from "@/lib/scoring-v2/release-watch";
import { recomputeAffectedMarketsForCountries, recomputeSymbols } from "@/lib/scoring-v2/recompute";
import { upsertEconomicEventFromZapier, insertNewsArticleFromZapier, updateNewsArticleClassification } from "@/db/queries/market-data";
import { logZapierIngest } from "@/db/queries/zapier-ingest-log";
import { recordAuthAttempt } from "@/db/queries/rate-limit";
import { recordEventShock } from "@/db/queries/economic-releases";
import { classifyNewsWithLLM } from "@/lib/engines/llm-news-classifier";
import { isDemoMode } from "../../../cron/_shared";
import { NextRequest } from "next/server";
import { POST } from "./route";

function req(body: unknown, opts: { secret?: string; dryRun?: boolean } = {}): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.secret) headers.set("authorization", `Bearer ${opts.secret}`);
  const url = `https://example.com/api/integrations/zapier/market-event${opts.dryRun ? "?dryRun=1" : ""}`;
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });
}

const economicEventPayload = {
  type: "economic_event",
  currency: "USD",
  event: "CPI m/m",
  scheduledAt: "2027-01-15T13:30:00.000Z",
  actual: "0.4%",
  forecast: "0.2%",
  previous: "0.1%",
};

const newsPayload = {
  type: "news",
  headline: "Fed signals rates may remain higher for longer",
  summary: "The Fed hinted at extended tightening.",
  source: "ForexFactory",
  publishedAt: "2027-01-15T13:30:00.000Z",
};

describe("POST /api/integrations/zapier/market-event", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ZAPIER_INGEST_SECRET = "test-zapier-secret";
    vi.mocked(isDemoMode).mockReturnValue(false);
    vi.mocked(recordAuthAttempt).mockResolvedValue(1);
    vi.mocked(upsertEconomicEventFromZapier).mockResolvedValue(42);
    vi.mocked(logZapierIngest).mockResolvedValue(undefined);
    vi.mocked(processReleases).mockResolvedValue({
      scanned: 1,
      processed: [{ releaseKey: "zapier-forexfactory:US:cpi:2027-01-15T13:30:00.000Z", country: "US", indicatorKey: "cpi", importanceTier: "HIGH", surpriseId: 1 }],
      skippedCount: 0,
      diagnosticsCount: 0,
      failCount: 0,
    });
    vi.mocked(recomputeAffectedMarketsForCountries).mockResolvedValue(["EURUSD", "GBPUSD"]);
    vi.mocked(insertNewsArticleFromZapier).mockResolvedValue(7);
    vi.mocked(updateNewsArticleClassification).mockResolvedValue(undefined);
    vi.mocked(recordEventShock).mockResolvedValue(undefined);
    vi.mocked(recomputeSymbols).mockResolvedValue(["EURUSD"]);
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

  it("rejects a request with no bearer token, touching neither the DB nor rate limiter", async () => {
    const res = await POST(req(economicEventPayload));
    expect(res.status).toBe(401);
    expect(recordAuthAttempt).not.toHaveBeenCalled();
    expect(upsertEconomicEventFromZapier).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const res = await POST(req(economicEventPayload, { secret: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("fails closed when ZAPIER_INGEST_SECRET is unset", async () => {
    delete process.env.ZAPIER_INGEST_SECRET;
    const res = await POST(req(economicEventPayload, { secret: "anything" }));
    expect(res.status).toBe(401);
  });

  it("rejects a malformed payload with a logged outcome, before touching any write function", async () => {
    const res = await POST(req({ type: "economic_event" }, { secret: "test-zapier-secret" }));
    expect(res.status).toBe(400);
    expect(logZapierIngest).toHaveBeenCalledWith(expect.objectContaining({ outcome: "rejected_invalid_payload" }));
    expect(upsertEconomicEventFromZapier).not.toHaveBeenCalled();
  });

  it("rate-limits after the configured threshold", async () => {
    vi.mocked(recordAuthAttempt).mockResolvedValue(1000);
    const res = await POST(req(economicEventPayload, { secret: "test-zapier-secret" }));
    expect(res.status).toBe(429);
    expect(upsertEconomicEventFromZapier).not.toHaveBeenCalled();
  });

  it("dry-run: validates/normalizes/classifies but writes nothing at all", async () => {
    const res = await POST(req(economicEventPayload, { secret: "test-zapier-secret", dryRun: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.wouldWrite.indicatorKey).toBe("cpi");
    expect(upsertEconomicEventFromZapier).not.toHaveBeenCalled();
    expect(processReleases).not.toHaveBeenCalled();
    expect(recomputeAffectedMarketsForCountries).not.toHaveBeenCalled();
  });

  it("writes the base row, surprise-scores it, and recomputes only the affected countries", async () => {
    const res = await POST(req(economicEventPayload, { secret: "test-zapier-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(upsertEconomicEventFromZapier).toHaveBeenCalledWith(expect.objectContaining({ country: "US", indicatorKey: "cpi" }));
    expect(processReleases).toHaveBeenCalledWith([expect.objectContaining({ country: "US", indicatorKey: "cpi", actual: 0.4, forecast: 0.2, previous: 0.1 })]);
    expect(recomputeAffectedMarketsForCountries).toHaveBeenCalledWith(["US"]);
    expect(body.recomputedMarkets).toEqual(["EURUSD", "GBPUSD"]);
  });

  it("still writes the base row for an unclassifiable event, but never calls processReleases or recompute", async () => {
    const res = await POST(req({ ...economicEventPayload, event: "Some Unrecognized Event Name" }, { secret: "test-zapier-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processingStatus).toBe("unclassified");
    expect(upsertEconomicEventFromZapier).toHaveBeenCalledWith(expect.objectContaining({ indicatorKey: null }));
    expect(processReleases).not.toHaveBeenCalled();
    expect(recomputeAffectedMarketsForCountries).not.toHaveBeenCalled();
  });

  it("does not recompute anything when processReleases reports nothing newly processed (revision/duplicate)", async () => {
    vi.mocked(processReleases).mockResolvedValue({ scanned: 1, processed: [], skippedCount: 1, diagnosticsCount: 0, failCount: 0 });
    const res = await POST(req(economicEventPayload, { secret: "test-zapier-secret" }));
    expect(res.status).toBe(200);
    expect(recomputeAffectedMarketsForCountries).not.toHaveBeenCalled();
  });

  describe("news payloads", () => {
    it("dry-run: classifies but writes nothing", async () => {
      const res = await POST(req(newsPayload, { secret: "test-zapier-secret", dryRun: true }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.dryRun).toBe(true);
      expect(insertNewsArticleFromZapier).not.toHaveBeenCalled();
      expect(classifyNewsWithLLM).toHaveBeenCalled();
    });

    it("classifies and records a shock for high-relevance news with affected markets", async () => {
      const res = await POST(req(newsPayload, { secret: "test-zapier-secret" }));
      expect(res.status).toBe(200);
      expect(insertNewsArticleFromZapier).toHaveBeenCalled();
      expect(updateNewsArticleClassification).toHaveBeenCalledWith(7, expect.objectContaining({ classifierModel: "claude-opus-5" }));
      expect(recordEventShock).toHaveBeenCalledWith(expect.objectContaining({ symbol: "EURUSD", sourceReleaseId: null, factorKey: null }));
      const body = await res.json();
      expect(body.recomputedMarkets).toEqual(["EURUSD"]);
    });

    it("skips classification entirely for a duplicate delivery (cost control)", async () => {
      vi.mocked(insertNewsArticleFromZapier).mockResolvedValue(null);
      const res = await POST(req(newsPayload, { secret: "test-zapier-secret" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.duplicate).toBe(true);
      expect(classifyNewsWithLLM).not.toHaveBeenCalled();
    });

    it("falls back to the keyword classifier when the LLM throws, and records classifierModel:null", async () => {
      vi.mocked(classifyNewsWithLLM).mockRejectedValue(new Error("API down"));
      const res = await POST(req(newsPayload, { secret: "test-zapier-secret" }));
      expect(res.status).toBe(200);
      expect(updateNewsArticleClassification).toHaveBeenCalledWith(7, expect.objectContaining({ classifierModel: null }));
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
      const res = await POST(req(newsPayload, { secret: "test-zapier-secret" }));
      expect(res.status).toBe(200);
      expect(recordEventShock).not.toHaveBeenCalled();
    });
  });
});
