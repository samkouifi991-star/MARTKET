// Asset-class macro polarity map — the single place that decides whether
// "the economy is getting stronger" is good or bad news for a given asset.
// The generic macro model (macro.ts) used to assume stronger growth/labor
// data is universally bullish, which is right for equities and broadly
// pro-cyclical assets but backwards for gold: a hotter economy raises real
// yields and reduces safe-haven demand, both bearish for a non-yielding
// metal. This map exists so that mistake doesn't quietly repeat the next
// time an asset class needs its own polarity — every consumer should read
// the sign from here rather than assuming +1.
import { Instrument } from "@/lib/types";

export type MacroPolarityClass = "PreciousMetals" | "FX" | "EquityIndices" | "Crypto" | "GenericCommodity";

// XAGUSD/XPTUSD share Gold's growth/labor polarity (all three are, first
// and foremost, monetary/safe-haven metals priced against real yields and
// the dollar) even though the dedicated FRED-driven composite in
// gold-macro.ts is currently wired for XAUUSD only — see that file's header
// for why Silver/Platinum's industrial-demand exposure isn't folded into
// the same composite without its own separate validation.
const PRECIOUS_METALS = new Set(["XAUUSD", "XAGUSD", "XPTUSD"]);

export function macroPolarityClassFor(instrument: Instrument): MacroPolarityClass {
  if (PRECIOUS_METALS.has(instrument.symbol)) return "PreciousMetals";
  // FX pairs are excluded from the table below entirely: macro.ts already
  // scores them as a two-country differential (a pair only benefits from
  // ITS base country outgrowing its quote country), which is directionally
  // self-correcting and needs no asset-level polarity override.
  if (instrument.currencies) return "FX";
  if (instrument.assetClass === "Indices") return "EquityIndices";
  if (instrument.assetClass === "Crypto") return "Crypto";
  return "GenericCommodity";
}

// Sign applied to a country's growth/labor strength score before it becomes
// that asset's economicGrowth/labor rawScore (see macro.ts's
// resolveMacroCategory). +1 = "a stronger economy is bullish" (equities and
// other broadly pro-cyclical assets); -1 = "a stronger economy is a
// headwind" (precious metals: higher real yields and reduced safe-haven
// demand outweigh any growth-linked demand for the metal itself).
// GenericCommodity (oil, natural gas, copper) stays +1 — these are
// industrial/demand-driven commodities whose macro sensitivity resembles
// equities far more than it resembles gold's monetary-metal role.
export const GROWTH_LABOR_POLARITY: Record<MacroPolarityClass, 1 | -1> = {
  PreciousMetals: -1,
  FX: 1,
  EquityIndices: 1,
  Crypto: 1,
  GenericCommodity: 1,
};

export function growthLaborPolarity(instrument: Instrument): 1 | -1 {
  return GROWTH_LABOR_POLARITY[macroPolarityClassFor(instrument)];
}
