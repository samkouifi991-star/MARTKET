import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./engine");
vi.mock("@/services/data-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/data-mode")>();
  return { ...actual, strictLiveSymbolList: vi.fn() };
});

import { computeMarketScoreV2 } from "./engine";
import { strictLiveSymbolList } from "@/services/data-mode";
import { recomputeAffectedMarketsForCountries, recomputeSymbols } from "./recompute";

describe("recomputeSymbols", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(strictLiveSymbolList).mockReturnValue(["EURUSD", "GBPUSD", "XAUUSD"]);
    vi.mocked(computeMarketScoreV2).mockResolvedValue({} as never);
  });

  it("only recomputes symbols that are both requested and strict-live", async () => {
    const recomputed = await recomputeSymbols(["EURUSD", "NAS100", "XAUUSD"]);
    expect(recomputed.sort()).toEqual(["EURUSD", "XAUUSD"]);
    expect(computeMarketScoreV2).toHaveBeenCalledTimes(2);
  });

  it("does not let one symbol's rejection block others from recomputing", async () => {
    vi.mocked(computeMarketScoreV2).mockImplementation(async (symbol: string) => {
      if (symbol === "EURUSD") throw new Error("boom");
      return {} as never;
    });
    const recomputed = await recomputeSymbols(["EURUSD", "GBPUSD"]);
    expect(recomputed).toEqual(["GBPUSD"]);
  });
});

describe("recomputeAffectedMarketsForCountries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(strictLiveSymbolList).mockReturnValue(["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"]);
    vi.mocked(computeMarketScoreV2).mockResolvedValue({} as never);
  });

  it("recomputes only the strict-live markets affectedMarketsFor names for the given countries", async () => {
    const recomputed = await recomputeAffectedMarketsForCountries(["US"]);
    // US affects USD pairs + gold/silver/indices/crypto, but only the
    // strict-live-mocked subset should actually get recomputed.
    expect(recomputed.sort()).toEqual(["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"].sort());
  });

  it("deduplicates overlapping countries into one recompute per symbol", async () => {
    await recomputeAffectedMarketsForCountries(["US", "US"]);
    const calledSymbols = vi.mocked(computeMarketScoreV2).mock.calls.map((c) => c[0]);
    expect(new Set(calledSymbols).size).toBe(calledSymbols.length);
  });
});
