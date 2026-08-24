import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NormalizedQuote, Provenance } from "../types";

vi.mock("./fmp");
vi.mock("./oanda-market-data");

import * as fmp from "./fmp";
import * as oanda from "./oanda-market-data";
import { getQuote, getDailyCandles, getIntradayCandles } from "./market-data-router";

function live(provider: "fmp" | "oanda", price: number): Provenance<NormalizedQuote> {
  return {
    provider,
    source: provider === "oanda" ? "OANDA v20" : "Financial Modeling Prep",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    nextExpectedUpdate: null,
    value: { symbol: "GBPUSD", price, changePct24h: 0, timestamp: new Date().toISOString() },
  };
}

const down = (provider: "fmp" | "oanda"): Provenance<NormalizedQuote> => ({
  provider,
  source: provider === "oanda" ? "OANDA v20" : "Financial Modeling Prep",
  status: "unavailable",
  fetchedAt: new Date().toISOString(),
  sourceUpdatedAt: null,
  nextExpectedUpdate: null,
  value: null,
  error: "simulated outage",
});

beforeEach(() => vi.resetAllMocks());

describe("market-data-router — FX routes OANDA-primary, FMP-secondary", () => {
  it("returns OANDA's result for GBPUSD without ever calling FMP when OANDA succeeds", async () => {
    vi.mocked(oanda.getQuote).mockResolvedValue(live("oanda", 1.29));

    const result = await getQuote("GBPUSD");

    expect(result.provider).toBe("oanda");
    expect(fmp.getQuote).not.toHaveBeenCalled();
  });

  it("falls back to FMP for GBPUSD when OANDA fails live", async () => {
    vi.mocked(oanda.getQuote).mockResolvedValue(down("oanda"));
    vi.mocked(fmp.getQuote).mockResolvedValue(live("fmp", 1.29));

    const result = await getQuote("GBPUSD");

    expect(result.provider).toBe("fmp");
  });

  it("returns the OANDA (primary) result when both OANDA and FMP fail live", async () => {
    vi.mocked(oanda.getQuote).mockResolvedValue(down("oanda"));
    vi.mocked(fmp.getQuote).mockResolvedValue(down("fmp"));

    const result = await getQuote("GBPUSD");

    expect(result.provider).toBe("oanda");
    expect(result.status).toBe("unavailable");
  });

  it("routes daily and intraday candles the same OANDA-first way", async () => {
    vi.mocked(oanda.getDailyCandles).mockResolvedValue({ ...live("oanda", 0), value: [] } as unknown as Provenance<never>);
    vi.mocked(oanda.getIntradayCandles).mockResolvedValue({ ...live("oanda", 0), value: [] } as unknown as Provenance<never>);

    await getDailyCandles("GBPUSD");
    await getIntradayCandles("GBPUSD", "1hour");

    expect(oanda.getDailyCandles).toHaveBeenCalledWith("GBPUSD", 260);
    expect(oanda.getIntradayCandles).toHaveBeenCalledWith("GBPUSD", "H1");
    expect(fmp.getDailyCandles).not.toHaveBeenCalled();
    expect(fmp.getIntradayCandles).not.toHaveBeenCalled();
  });

  it("maps '4hour' to OANDA granularity 'H4'", async () => {
    vi.mocked(oanda.getIntradayCandles).mockResolvedValue({ ...live("oanda", 0), value: [] } as unknown as Provenance<never>);

    await getIntradayCandles("GBPUSD", "4hour");

    expect(oanda.getIntradayCandles).toHaveBeenCalledWith("GBPUSD", "H4");
  });
});

describe("market-data-router — non-FX always uses FMP, never touches OANDA", () => {
  it("routes XAUUSD straight to FMP for quote/daily/intraday", async () => {
    vi.mocked(fmp.getQuote).mockResolvedValue(live("fmp", 2400));
    vi.mocked(fmp.getDailyCandles).mockResolvedValue({ ...live("fmp", 0), value: [] } as unknown as Provenance<never>);
    vi.mocked(fmp.getIntradayCandles).mockResolvedValue({ ...live("fmp", 0), value: [] } as unknown as Provenance<never>);

    await getQuote("XAUUSD");
    await getDailyCandles("XAUUSD");
    await getIntradayCandles("XAUUSD", "1hour");

    expect(oanda.getQuote).not.toHaveBeenCalled();
    expect(oanda.getDailyCandles).not.toHaveBeenCalled();
    expect(oanda.getIntradayCandles).not.toHaveBeenCalled();
  });

  it("routes SPX500 (index) and ETHUSD (crypto) straight to FMP too", async () => {
    vi.mocked(fmp.getQuote).mockResolvedValue(live("fmp", 5000));

    await getQuote("SPX500");
    await getQuote("ETHUSD");

    expect(oanda.getQuote).not.toHaveBeenCalled();
    expect(fmp.getQuote).toHaveBeenCalledTimes(2);
  });
});
