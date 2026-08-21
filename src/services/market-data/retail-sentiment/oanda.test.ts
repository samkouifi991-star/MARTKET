import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, statusText: ok ? "OK" : "Error", text: async () => JSON.stringify(body), json: async () => body } as Response;
}

describe("oanda PositionBook", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.OANDA_API_TOKEN = "test-token";
    delete process.env.OANDA_ENVIRONMENT;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("returns unavailable, without ever calling fetch, for a symbol OANDA doesn't cover", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { oandaProvider } = await import("./oanda");

    const result = await oandaProvider.getRetailSentiment("BTCUSD");

    expect(result.status).toBe("unavailable");
    expect(result.value).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns unavailable, without ever calling fetch, when OANDA_API_TOKEN is not configured", async () => {
    delete process.env.OANDA_API_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { oandaProvider } = await import("./oanda");

    const result = await oandaProvider.getRetailSentiment("GBPUSD");

    expect(result.status).toBe("unavailable");
    expect(result.error).toMatch(/OANDA_API_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hits the practice host by default and the live host when OANDA_ENVIRONMENT=live", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ positionBook: { instrument: "GBP_USD", time: "2026-08-21T00:00:00Z", buckets: [{ price: "1.27000", longCountPercent: "50", shortCountPercent: "50" }] } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { oandaProvider } = await import("./oanda");
    await oandaProvider.getRetailSentiment("GBPUSD");
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/api-fxpractice\.oanda\.com\//);

    vi.resetModules();
    process.env.OANDA_ENVIRONMENT = "live";
    const fetchMock2 = vi.fn().mockResolvedValue(
      jsonResponse({ positionBook: { instrument: "GBP_USD", time: "2026-08-21T00:00:00Z", buckets: [{ price: "1.27000", longCountPercent: "50", shortCountPercent: "50" }] } })
    );
    vi.stubGlobal("fetch", fetchMock2);
    const { oandaProvider: oandaLive } = await import("./oanda");
    await oandaLive.getRetailSentiment("GBPUSD");
    expect(fetchMock2.mock.calls[0][0]).toMatch(/^https:\/\/api-fxtrade\.oanda\.com\//);
  });

  it("aggregates bucket longCountPercent/shortCountPercent into a renormalized 0-100 pctLong/pctShort split", async () => {
    // Three buckets, deliberately not summing to 100 with each other (an
    // unclassifiedPositionRatio would cover the remainder) — the point is
    // that pctLong/pctShort renormalize to just the long+short buckets,
    // not the raw bucket sums.
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        positionBook: {
          instrument: "GBP_USD",
          time: "2026-08-21T12:00:00Z",
          unclassifiedPositionRatio: "0.05",
          buckets: [
            { price: "1.26000", longCountPercent: "20", shortCountPercent: "10" },
            { price: "1.27000", longCountPercent: "15", shortCountPercent: "25" },
            { price: "1.28000", longCountPercent: "5", shortCountPercent: "20" },
          ],
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { oandaProvider } = await import("./oanda");

    const result = await oandaProvider.getRetailSentiment("GBPUSD");

    // aggregateLong = 20+15+5 = 40, aggregateShort = 10+25+20 = 55, total = 95
    expect(result.status).toBe("live");
    expect(result.provider).toBe("oanda");
    expect(result.source).toBe("OANDA PositionBook");
    expect(result.value!.aggregateLongWeight).toBeCloseTo(40);
    expect(result.value!.aggregateShortWeight).toBeCloseTo(55);
    expect(result.value!.totalPositioningWeight).toBeCloseTo(95);
    expect(result.value!.pctLong).toBeCloseTo((40 / 95) * 100);
    expect(result.value!.pctShort).toBeCloseTo((55 / 95) * 100);
    expect(result.value!.pctLong + result.value!.pctShort).toBeCloseTo(100);
    expect(result.sourceUpdatedAt).toBe("2026-08-21T12:00:00Z");
  });

  it("produces the same pctLong/pctShort ratio whether OANDA expresses bucket percentages as fractions or as percentages (scale-invariant renormalization)", async () => {
    const fractionBuckets = [
      { price: "1.26000", longCountPercent: "0.20", shortCountPercent: "0.10" },
      { price: "1.27000", longCountPercent: "0.15", shortCountPercent: "0.25" },
    ];
    const percentBuckets = [
      { price: "1.26000", longCountPercent: "20", shortCountPercent: "10" },
      { price: "1.27000", longCountPercent: "15", shortCountPercent: "25" },
    ];

    const fetchMock1 = vi.fn().mockResolvedValue(jsonResponse({ positionBook: { instrument: "GBP_USD", time: "t", buckets: fractionBuckets } }));
    vi.stubGlobal("fetch", fetchMock1);
    const { oandaProvider: providerA } = await import("./oanda");
    const resultA = await providerA.getRetailSentiment("GBPUSD");

    vi.resetModules();
    process.env.OANDA_API_TOKEN = "test-token";
    const fetchMock2 = vi.fn().mockResolvedValue(jsonResponse({ positionBook: { instrument: "GBP_USD", time: "t", buckets: percentBuckets } }));
    vi.stubGlobal("fetch", fetchMock2);
    const { oandaProvider: providerB } = await import("./oanda");
    const resultB = await providerB.getRetailSentiment("GBPUSD");

    expect(resultA.value!.pctLong).toBeCloseTo(resultB.value!.pctLong!);
    expect(resultA.value!.pctShort).toBeCloseTo(resultB.value!.pctShort!);
  });

  it("returns unavailable when the response has no positionBook.buckets", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ positionBook: { instrument: "GBP_USD", time: "t", buckets: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    const { oandaProvider } = await import("./oanda");

    const result = await oandaProvider.getRetailSentiment("GBPUSD");

    expect(result.status).toBe("unavailable");
    expect(result.value).toBeNull();
  });

  it("returns unavailable when every bucket has zero classified positioning", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ positionBook: { instrument: "GBP_USD", time: "t", buckets: [{ price: "1.27000", longCountPercent: "0", shortCountPercent: "0" }] } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { oandaProvider } = await import("./oanda");

    const result = await oandaProvider.getRetailSentiment("GBPUSD");

    expect(result.status).toBe("unavailable");
  });

  it("returns error (never throws, never fabricates) on a non-2xx response, and never logs the token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ errorMessage: "Invalid Authorization header" }, false, 401));
    vi.stubGlobal("fetch", fetchMock);
    const { oandaProvider } = await import("./oanda");

    const result = await oandaProvider.getRetailSentiment("GBPUSD");

    expect(result.status).toBe("error");
    expect(result.value).toBeNull();
    expect(result.error).not.toMatch(/test-token/);
  });

  it("sends the token only as an Authorization header, never in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ positionBook: { instrument: "GBP_USD", time: "t", buckets: [{ price: "1.27000", longCountPercent: "50", shortCountPercent: "50" }] } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { oandaProvider } = await import("./oanda");

    await oandaProvider.getRetailSentiment("GBPUSD");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toMatch(/test-token/);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-token" });
  });
});
