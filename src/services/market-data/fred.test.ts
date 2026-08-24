import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { classifyFredFreshness, getSeries } from "./fred";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
}

describe("classifyFredFreshness", () => {
  it("classifies a monthly series (CPI) within ~2 months as live", () => {
    const { freshness, cadence } = classifyFredFreshness("cpi", isoDaysAgo(30));
    expect(cadence).toBe("monthly");
    expect(freshness).toBe("live");
  });

  it("classifies a monthly series a few months old as delayed, not live", () => {
    const { freshness } = classifyFredFreshness("cpi", isoDaysAgo(90));
    expect(freshness).toBe("delayed");
  });

  it("classifies the real-world GB CPI case (~17 months old) as stale, not live", () => {
    // The exact bug this was built to fix: GBRCPIALLMINMEI resolves fine
    // but FRED's own last observation was ~17 months old at verification.
    const { freshness, ageDays } = classifyFredFreshness("cpi", isoDaysAgo(510));
    expect(freshness).toBe("stale");
    expect(ageDays).toBeGreaterThan(500);
  });

  it("classifies a quarterly series (GDP) several months old as still live", () => {
    // Quarterly data with real-world publication lag shouldn't read as
    // delayed just because it's 2-3 months old.
    const { freshness } = classifyFredFreshness("gdpGrowth", isoDaysAgo(100));
    expect(freshness).toBe("live");
  });

  it("classifies a daily series (policy rate) a couple weeks old as delayed", () => {
    const { freshness } = classifyFredFreshness("policyRate", isoDaysAgo(10));
    expect(freshness).toBe("delayed");
  });
});

describe("getSeries freshness propagation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.FRED_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FRED_API_KEY;
  });

  it("returns status=stale (not live) for a verified series with old observations, with a descriptive error", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        observations: [{ date: isoDaysAgo(510), value: "136.1" }],
      })
    );

    const result = await getSeries("GB", "cpi");

    expect(result.status).toBe("stale");
    expect(result.value).not.toBeNull(); // real data is still returned, just marked stale
    expect(result.error).toMatch(/stale/i);
  });

  it("returns status=live for a verified series with recent observations", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        observations: [{ date: isoDaysAgo(2), value: "3.6" }],
      })
    );

    const result = await getSeries("US", "policyRate");

    expect(result.status).toBe("live");
    expect(result.error).toBeUndefined();
  });
});
