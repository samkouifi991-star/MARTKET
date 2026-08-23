import { describe, expect, it } from "vitest";
import { getInstrument } from "@/lib/instruments";
import { growthLaborPolarity, macroPolarityClassFor } from "./asset-polarity";

function instrument(symbol: string) {
  const found = getInstrument(symbol);
  if (!found) throw new Error(`fixture bug: ${symbol} is not a real instrument`);
  return found;
}

describe("macroPolarityClassFor", () => {
  it("classifies Gold, Silver, and Platinum as PreciousMetals even though their assetClass is the generic 'Commodities' bucket", () => {
    expect(macroPolarityClassFor(instrument("XAUUSD"))).toBe("PreciousMetals");
    expect(macroPolarityClassFor(instrument("XAGUSD"))).toBe("PreciousMetals");
    expect(macroPolarityClassFor(instrument("XPTUSD"))).toBe("PreciousMetals");
  });

  it("classifies other Commodities (oil, copper, natgas) as GenericCommodity, not PreciousMetals", () => {
    expect(macroPolarityClassFor(instrument("WTIUSD"))).toBe("GenericCommodity");
    expect(macroPolarityClassFor(instrument("COPPER"))).toBe("GenericCommodity");
    expect(macroPolarityClassFor(instrument("NATGAS"))).toBe("GenericCommodity");
  });

  it("classifies every FX pair as FX", () => {
    expect(macroPolarityClassFor(instrument("EURUSD"))).toBe("FX");
    expect(macroPolarityClassFor(instrument("GBPJPY"))).toBe("FX");
  });

  it("classifies Indices as EquityIndices", () => {
    expect(macroPolarityClassFor(instrument("SPX500"))).toBe("EquityIndices");
    expect(macroPolarityClassFor(instrument("FTSE100"))).toBe("EquityIndices");
  });

  it("classifies Crypto as Crypto", () => {
    expect(macroPolarityClassFor(instrument("BTCUSD"))).toBe("Crypto");
    expect(macroPolarityClassFor(instrument("ETHUSD"))).toBe("Crypto");
  });
});

describe("growthLaborPolarity", () => {
  it("flips to -1 for precious metals — a stronger economy is a headwind, not a tailwind, for gold", () => {
    expect(growthLaborPolarity(instrument("XAUUSD"))).toBe(-1);
    expect(growthLaborPolarity(instrument("XAGUSD"))).toBe(-1);
    expect(growthLaborPolarity(instrument("XPTUSD"))).toBe(-1);
  });

  it("stays +1 for every other asset class — the old, generic 'stronger economy is bullish' behavior is unchanged for them", () => {
    expect(growthLaborPolarity(instrument("EURUSD"))).toBe(1);
    expect(growthLaborPolarity(instrument("SPX500"))).toBe(1);
    expect(growthLaborPolarity(instrument("BTCUSD"))).toBe(1);
    expect(growthLaborPolarity(instrument("WTIUSD"))).toBe(1);
  });
});
