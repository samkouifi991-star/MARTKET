import { describe, expect, it } from "vitest";
import { classifyIndicatorSurprise, classifyMacroTrend, classifyRateDecisionBias, flipClassificationForQuoteSide } from "./indicator-classification";

const GOLD = { symbol: "XAUUSD", name: "Gold", assetClass: "Commodities" as const, decimals: 2 };
const SPX500 = { symbol: "SPX500", name: "S&P 500", assetClass: "Indices" as const, macroCountry: "US", decimals: 2 };
const BTCUSD = { symbol: "BTCUSD", name: "Bitcoin", assetClass: "Crypto" as const, macroCountry: "US", decimals: 2 };
const OIL = { symbol: "USOIL", name: "Crude Oil", assetClass: "Commodities" as const, macroCountry: "US", decimals: 2 };
const GBPUSD = { symbol: "GBPUSD", name: "British Pound / US Dollar", assetClass: "Forex" as const, currencies: ["GBP", "USD"] as [string, string], decimals: 4 };
const USDJPY = { symbol: "USDJPY", name: "US Dollar / Japanese Yen", assetClass: "Forex" as const, currencies: ["USD", "JPY"] as [string, string], decimals: 3 };

describe("classifyIndicatorSurprise", () => {
  it("never returns a badge when forecast is null — no unavailable macro indicator is fabricated", () => {
    expect(classifyIndicatorSurprise(GOLD, "gdp", 3.0, null)).toBeNull();
  });

  it("never returns a badge when actual is null", () => {
    expect(classifyIndicatorSurprise(GOLD, "gdp", null, 2.0)).toBeNull();
  });

  it("inverts growth/labor polarity for gold: a growth BEAT reads Bearish (stronger economy is a headwind for a non-yielding metal)", () => {
    expect(classifyIndicatorSurprise(GOLD, "gdp", 3.0, 2.0)).toBe("Bearish");
  });

  it("a growth MISS reads Bullish for gold", () => {
    expect(classifyIndicatorSurprise(GOLD, "gdp", 1.0, 2.0)).toBe("Bullish");
  });

  it("does not invert growth/labor polarity for equities: a growth beat reads Bullish", () => {
    expect(classifyIndicatorSurprise(SPX500, "gdp", 3.0, 2.0)).toBe("Bullish");
  });

  it("does not invert growth/labor polarity for FX: a growth beat reads Bullish", () => {
    expect(classifyIndicatorSurprise(GBPUSD, "nfp", 200_000, 150_000)).toBe("Bullish");
  });

  it("flips direction for higher-is-weaker indicators: a LOWER unemployment rate than forecast is economically strong, so it reads Bullish for equities", () => {
    expect(classifyIndicatorSurprise(SPX500, "unemploymentRate", 3.8, 4.0)).toBe("Bullish");
  });

  it("flips direction for higher-is-weaker indicators: a lower unemployment rate (economically strong) reads Bearish for gold (inverted polarity)", () => {
    expect(classifyIndicatorSurprise(GOLD, "unemploymentRate", 3.8, 4.0)).toBe("Bearish");
  });

  it("flips direction for jobless claims the same way", () => {
    expect(classifyIndicatorSurprise(SPX500, "joblessClaims", 180_000, 210_000)).toBe("Bullish");
  });

  it("inflation always uses +1 polarity regardless of asset class: a hot CPI beat reads Bullish for gold", () => {
    expect(classifyIndicatorSurprise(GOLD, "cpi", 3.5, 3.2)).toBe("Bullish");
  });

  it("inflation always uses +1 polarity for equities too, matching the existing generic macro.ts assumption", () => {
    expect(classifyIndicatorSurprise(SPX500, "cpi", 3.5, 3.2)).toBe("Bullish");
  });

  it("a cool inflation miss reads Bearish", () => {
    expect(classifyIndicatorSurprise(GOLD, "cpi", 3.0, 3.2)).toBe("Bearish");
  });

  it("an exact in-line print reads Neutral", () => {
    expect(classifyIndicatorSurprise(GOLD, "cpi", 3.2, 3.2)).toBe("Neutral");
  });

  it("returns null for a rate-decision or unrelated indicator — this module only classifies growth/labor and inflation releases", () => {
    expect(classifyIndicatorSurprise(GOLD, "fedRateDecision", 4.5, 4.25)).toBeNull();
    expect(classifyIndicatorSurprise(GOLD, "housingData", 1.5, 1.4)).toBeNull();
  });

  it("classifies consumerConfidence/michiganSentiment as growth-sentiment reads even though V2's own taxonomy files them as 'other' for shock-dispatch purposes", () => {
    expect(classifyIndicatorSurprise(SPX500, "consumerConfidence", 105, 100)).toBe("Bullish");
    expect(classifyIndicatorSurprise(GOLD, "michiganSentiment", 105, 100)).toBe("Bearish");
  });
});

describe("classifyMacroTrend — same polarity model, applied to a period-over-period FRED change instead of a calendar surprise", () => {
  it("a rising GDP growth rate reads Bullish for equities, Bearish for gold (inverted polarity, same as classifyIndicatorSurprise's growth case)", () => {
    expect(classifyMacroTrend(SPX500, "growth", 0.5)).toBe("Bullish");
    expect(classifyMacroTrend(GOLD, "growth", 0.5)).toBe("Bearish");
  });

  it("a falling GDP growth rate reads Bearish for equities, Bullish for gold", () => {
    expect(classifyMacroTrend(SPX500, "growth", -0.3)).toBe("Bearish");
    expect(classifyMacroTrend(GOLD, "growth", -0.3)).toBe("Bullish");
  });

  it("a rising unemployment rate (economically weaker) reads Bearish for equities, Bullish for gold — jobs inverts direction before polarity, same as classifyIndicatorSurprise's unemploymentRate case", () => {
    expect(classifyMacroTrend(SPX500, "jobs", 0.2)).toBe("Bearish");
    expect(classifyMacroTrend(GOLD, "jobs", 0.2)).toBe("Bullish");
  });

  it("a falling unemployment rate (economically stronger) reads Bullish for equities, Bearish for gold", () => {
    expect(classifyMacroTrend(SPX500, "jobs", -0.2)).toBe("Bullish");
    expect(classifyMacroTrend(GOLD, "jobs", -0.2)).toBe("Bearish");
  });

  it("inflation always uses +1 polarity regardless of asset class: rising CPI reads Bullish even for gold", () => {
    expect(classifyMacroTrend(GOLD, "inflation", 1.2)).toBe("Bullish");
    expect(classifyMacroTrend(SPX500, "inflation", 1.2)).toBe("Bullish");
  });

  it("falling CPI reads Bearish", () => {
    expect(classifyMacroTrend(GOLD, "inflation", -0.8)).toBe("Bearish");
  });

  it("a zero change reads Neutral regardless of kind or asset", () => {
    expect(classifyMacroTrend(GOLD, "growth", 0)).toBe("Neutral");
    expect(classifyMacroTrend(SPX500, "jobs", 0)).toBe("Neutral");
    expect(classifyMacroTrend(GBPUSD, "inflation", 0)).toBe("Neutral");
  });
});

describe("classifyRateDecisionBias — display-only hawkish/dovish read of a rate DECISION, never a V1/V2 score input", () => {
  it("returns null (Unavailable) when forecast is missing — never a guessed Bias", () => {
    expect(classifyRateDecisionBias(GBPUSD, "GB", 4.25, null)).toBeNull();
  });

  it("an exact in-line decision (actual === forecast) always reads Neutral, regardless of asset class", () => {
    expect(classifyRateDecisionBias(GBPUSD, "GB", 4.0, 4.0)).toBe("Neutral");
    expect(classifyRateDecisionBias(GOLD, "US", 4.5, 4.5)).toBe("Neutral");
    expect(classifyRateDecisionBias(SPX500, "US", 4.5, 4.5)).toBe("Neutral");
  });

  it("FX: a hawkish surprise (actual > forecast) in the BASE currency reads Bullish for the pair", () => {
    expect(classifyRateDecisionBias(GBPUSD, "GB", 4.25, 4.0)).toBe("Bullish");
  });

  it("FX: a dovish surprise (actual < forecast) in the BASE currency reads Bearish for the pair", () => {
    expect(classifyRateDecisionBias(GBPUSD, "GB", 3.75, 4.0)).toBe("Bearish");
  });

  it("FX: a hawkish surprise in the QUOTE currency flips — reads Bearish for the pair", () => {
    expect(classifyRateDecisionBias(GBPUSD, "US", 4.75, 4.5)).toBe("Bearish");
  });

  it("FX: a dovish surprise in the QUOTE currency flips — reads Bullish for the pair", () => {
    expect(classifyRateDecisionBias(GBPUSD, "US", 4.25, 4.5)).toBe("Bullish");
  });

  it("FX: works symmetrically for a pair where USD is the base currency (USDJPY)", () => {
    expect(classifyRateDecisionBias(USDJPY, "US", 4.75, 4.5)).toBe("Bullish"); // hawkish base
    expect(classifyRateDecisionBias(USDJPY, "JP", 0.75, 0.5)).toBe("Bearish"); // hawkish quote
  });

  it("FX: a country that is neither side of the pair returns null rather than guessing", () => {
    expect(classifyRateDecisionBias(GBPUSD, "AU", 4.6, 4.35)).toBeNull();
  });

  it("Gold: a hawkish Fed surprise reads Bearish (higher real yields, reduced safe-haven demand)", () => {
    expect(classifyRateDecisionBias(GOLD, "US", 4.75, 4.5)).toBe("Bearish");
  });

  it("Gold: a dovish Fed surprise reads Bullish", () => {
    expect(classifyRateDecisionBias(GOLD, "US", 4.25, 4.5)).toBe("Bullish");
  });

  it("US equity indices: a hawkish Fed surprise reads Bearish, a dovish one Bullish", () => {
    expect(classifyRateDecisionBias(SPX500, "US", 4.75, 4.5)).toBe("Bearish");
    expect(classifyRateDecisionBias(SPX500, "US", 4.25, 4.5)).toBe("Bullish");
  });

  it("crypto: same Fed-hawkishness read as equities", () => {
    expect(classifyRateDecisionBias(BTCUSD, "US", 4.75, 4.5)).toBe("Bearish");
    expect(classifyRateDecisionBias(BTCUSD, "US", 4.25, 4.5)).toBe("Bullish");
  });

  it("an asset class with no established rate-decision transmission model (generic commodities) returns null rather than a guess", () => {
    expect(classifyRateDecisionBias(OIL, "US", 4.75, 4.5)).toBeNull();
  });
});

describe("flipClassificationForQuoteSide — turns a domestic-economy read into a pair-relative one for the FX quote side", () => {
  it("flips Bullish to Bearish", () => {
    expect(flipClassificationForQuoteSide("Bullish")).toBe("Bearish");
  });

  it("flips Bearish to Bullish", () => {
    expect(flipClassificationForQuoteSide("Bearish")).toBe("Bullish");
  });

  it("leaves Neutral unchanged — there's no direction to flip", () => {
    expect(flipClassificationForQuoteSide("Neutral")).toBe("Neutral");
  });

  it("leaves null unchanged — never fabricates a direction where none was established", () => {
    expect(flipClassificationForQuoteSide(null)).toBeNull();
  });
});
