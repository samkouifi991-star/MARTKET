import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, statusText: ok ? "OK" : "Error", text: async () => JSON.stringify(body), json: async () => body } as Response;
}

function candle(time: string, o: number, h: number, l: number, c: number, complete = true): unknown {
  return { complete, volume: 100, time, mid: { o: String(o), h: String(h), l: String(l), c: String(c) } };
}

describe("oanda-market-data", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.OANDA_API_TOKEN = "test-token";
    process.env.OANDA_ACCOUNT_ID = "test-account";
    delete process.env.OANDA_ENVIRONMENT;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  describe("candles (daily/H1/H4/backfill)", () => {
    it("returns unavailable, without calling fetch, for a symbol with no OANDA instrument mapping", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      const result = await oanda.getDailyCandles("BTCUSD");

      expect(result.status).toBe("unavailable");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns unavailable, without calling fetch, when OANDA_API_TOKEN is missing", async () => {
      delete process.env.OANDA_API_TOKEN;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      const result = await oanda.getDailyCandles("GBPUSD");

      expect(result.status).toBe("unavailable");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("excludes the still-forming (incomplete) candle and sorts oldest-first", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          instrument: "GBP_USD",
          granularity: "D",
          candles: [candle("2026-08-19T00:00:00Z", 1.27, 1.28, 1.26, 1.275), candle("2026-08-20T00:00:00Z", 1.275, 1.29, 1.27, 1.285), candle("2026-08-21T10:00:00Z", 1.285, 1.29, 1.28, 1.288, false)],
        })
      );
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      const result = await oanda.getDailyCandles("GBPUSD");

      expect(result.status).toBe("live");
      expect(result.value).toHaveLength(2); // incomplete bar excluded
      expect(result.value![0].date).toBe("2026-08-19T00:00:00Z");
      expect(result.value![1].date).toBe("2026-08-20T00:00:00Z");
      expect(result.sourceUpdatedAt).toBe("2026-08-20T00:00:00Z");
    });

    it("requests granularity=H1 for getIntradayCandles('H1') and H4 for 'H4'", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ candles: [candle("2026-08-21T10:00:00Z", 1, 1, 1, 1)] }));
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      await oanda.getIntradayCandles("GBPUSD", "H1");
      expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("granularity")).toBe("H1");

      await oanda.getIntradayCandles("GBPUSD", "H4");
      expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("granularity")).toBe("H4");
    });

    it("requests UTC/midnight daily alignment for granularity=D — so a daily bar's date is directly comparable to FMP's date-only convention", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ candles: [candle("2026-08-21T00:00:00Z", 1, 1, 1, 1)] }));
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      await oanda.getDailyCandles("GBPJPY");

      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.searchParams.get("alignmentTimezone")).toBe("UTC");
      expect(url.searchParams.get("dailyAlignment")).toBe("0");
    });

    it("does not set daily-alignment params for intraday (H1/H4) requests — only granularity=D has a day-boundary ambiguity", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ candles: [candle("2026-08-21T10:00:00Z", 1, 1, 1, 1)] }));
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      await oanda.getIntradayCandles("GBPJPY", "H1");

      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.searchParams.has("alignmentTimezone")).toBe(false);
      expect(url.searchParams.has("dailyAlignment")).toBe(false);
    });

    it("requests count=5000 for the max-depth backfill", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ candles: [candle("2026-08-21T00:00:00Z", 1, 1, 1, 1)] }));
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      await oanda.getDailyCandlesBackfill("GBPUSD");
      expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("count")).toBe("5000");
    });

    it("returns error, never throws, and never logs the token, on a non-2xx response", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ errorMessage: "Invalid Authorization" }, false, 401));
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      const result = await oanda.getDailyCandles("GBPUSD");

      expect(result.status).toBe("error");
      expect(result.error).not.toMatch(/test-token/);
    });

    it("hits the instrument-level candles endpoint without needing OANDA_ACCOUNT_ID", async () => {
      delete process.env.OANDA_ACCOUNT_ID;
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ candles: [candle("2026-08-21T00:00:00Z", 1, 1, 1, 1)] }));
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      const result = await oanda.getDailyCandles("GBPUSD");

      expect(result.status).toBe("live");
      expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/v3\/instruments\/GBP_USD\/candles/);
    });
  });

  describe("getQuote", () => {
    it("returns unavailable, without calling fetch, when OANDA_ACCOUNT_ID is missing — pricing is account-scoped unlike candles", async () => {
      delete process.env.OANDA_ACCOUNT_ID;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      const result = await oanda.getQuote("GBPUSD");

      expect(result.status).toBe("unavailable");
      expect(result.error).toMatch(/OANDA_ACCOUNT_ID/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("computes price as the bid/ask midpoint and changePct24h from the prior daily close", async () => {
      const fetchMock = vi.fn().mockImplementation(async (urlStr: string) => {
        const url = new URL(urlStr);
        if (url.pathname.includes("/pricing")) {
          return jsonResponse({ prices: [{ instrument: "GBP_USD", time: "2026-08-21T16:00:00Z", closeoutBid: "1.2900", closeoutAsk: "1.2902" }] });
        }
        // the internal prior-day candle fetch for changePct24h
        return jsonResponse({ candles: [candle("2026-08-20T00:00:00Z", 1.28, 1.285, 1.275, 1.28)] });
      });
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      const result = await oanda.getQuote("GBPUSD");

      expect(result.status).toBe("live");
      expect(result.value!.price).toBeCloseTo(1.2901);
      expect(result.value!.changePct24h).toBeCloseTo(((1.2901 - 1.28) / 1.28) * 100, 3);
      expect(result.sourceUpdatedAt).toBe("2026-08-21T16:00:00Z");
    });

    it("returns unavailable when the pricing response has no bid/ask", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ prices: [{ instrument: "GBP_USD", time: "2026-08-21T16:00:00Z" }] }));
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      const result = await oanda.getQuote("GBPUSD");

      expect(result.status).toBe("unavailable");
    });

    it("never puts the token in the request URL, only the Authorization header", async () => {
      const fetchMock = vi.fn().mockImplementation(async (urlStr: string) => {
        const url = new URL(urlStr);
        if (url.pathname.includes("/pricing")) return jsonResponse({ prices: [{ instrument: "GBP_USD", time: "t", closeoutBid: "1.29", closeoutAsk: "1.291" }] });
        return jsonResponse({ candles: [] });
      });
      vi.stubGlobal("fetch", fetchMock);
      const oanda = await import("./oanda-market-data");

      await oanda.getQuote("GBPUSD");

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).not.toMatch(/test-token/);
      expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-token" });
    });
  });
});
