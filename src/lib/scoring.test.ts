import { describe, expect, it } from "vitest";
import { macroFactor } from "./scoring";
import { getInstrument } from "./instruments";

function instrument(symbol: string) {
  const found = getInstrument(symbol);
  if (!found) throw new Error(`fixture bug: ${symbol} is not a real instrument`);
  return found;
}

describe("macroFactor — demo generator's growth/labor asset-class polarity", () => {
  it("flips Gold's growth score negative while a generic commodity (oil) stays positive for the same underlying US growth data", () => {
    const gold = macroFactor(instrument("XAUUSD"), "growthScore", "economic growth");
    const oil = macroFactor(instrument("WTIUSD"), "growthScore", "economic growth");

    // Same US economy input on both — only the polarity should differ.
    expect(Math.sign(gold.raw)).toBe(-Math.sign(oil.raw));
    expect(gold.explanation).toMatch(/headwind, not a tailwind/);
    expect(oil.explanation).not.toMatch(/headwind, not a tailwind/);
  });

  it("applies the same flip to labor market strength for Gold", () => {
    const gold = macroFactor(instrument("XAUUSD"), "laborScore", "labor market strength");
    const spx = macroFactor(instrument("SPX500"), "laborScore", "labor market strength");

    expect(Math.sign(gold.raw)).toBe(-Math.sign(spx.raw));
  });

  it("keeps Silver and Platinum on the same flipped polarity as Gold", () => {
    const silver = macroFactor(instrument("XAGUSD"), "growthScore", "economic growth");
    const platinum = macroFactor(instrument("XPTUSD"), "growthScore", "economic growth");
    const gold = macroFactor(instrument("XAUUSD"), "growthScore", "economic growth");

    expect(Math.sign(silver.raw)).toBe(Math.sign(gold.raw));
    expect(Math.sign(platinum.raw)).toBe(Math.sign(gold.raw));
  });
});
