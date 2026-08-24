import { describe, expect, it } from "vitest";
import { affectedMarketsFor, countryCodeFor } from "./affected-markets";

describe("affectedMarketsFor", () => {
  it("includes gold, silver, major indices AND crypto for a US release (regime/liquidity propagation)", () => {
    const markets = affectedMarketsFor("United States");
    expect(markets).toEqual(expect.arrayContaining(["XAUUSD", "XAGUSD", "SPX500", "NAS100", "DJ30", "RUT2000", "BTCUSD", "ETHUSD"]));
  });

  it("includes USD-quoted/based FX pairs for a US release", () => {
    const markets = affectedMarketsFor("United States");
    expect(markets).toEqual(expect.arrayContaining(["GBPUSD", "EURUSD", "USDJPY", "USDCAD", "USDCHF", "AUDUSD", "NZDUSD"]));
  });

  it("does not include crypto or indices for a non-USD country", () => {
    const markets = affectedMarketsFor("United Kingdom");
    expect(markets).not.toContain("BTCUSD");
    expect(markets).not.toContain("SPX500");
    expect(markets).toContain("GBPUSD");
  });

  it("returns an empty list for a country with no known currency mapping", () => {
    expect(affectedMarketsFor("Nowhereland")).toEqual([]);
  });
});

describe("countryCodeFor", () => {
  it("maps raw country labels to the shared 2-letter codes", () => {
    expect(countryCodeFor("United States")).toBe("US");
    expect(countryCodeFor("United Kingdom")).toBe("GB");
    expect(countryCodeFor("Japan")).toBe("JP");
  });

  it("returns null for an unmapped country rather than guessing", () => {
    expect(countryCodeFor("Nowhereland")).toBeNull();
  });
});
