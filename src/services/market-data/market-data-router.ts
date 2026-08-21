// Single entry point for live quote/candle data. Callers (last-known-good.ts,
// the prices/candles crons) must never import fmp.ts or oanda-market-data.ts
// directly for symbol-agnostic access — this is the only place that knows
// OANDA is primary for FX and FMP is primary for everything else, so a
// future reordering or new provider never requires touching the pipeline,
// crons, or UI. Mirrors the same "one combinator, callers don't choose"
// pattern already used for retail sentiment (retail-sentiment/index.ts).
//
// Routing rule: FX pairs with a confirmed OANDA instrument mapping try
// OANDA first, then FMP as a fallback where FMP itself supports the
// symbol; everything else (metals, indices, commodities, crypto) goes
// straight to FMP, unchanged. Storage-level last-known-good fallback (live
// failed entirely -> last stored Neon value) stays last-known-good.ts's
// job, layered on top of whatever this router returns.
import { getInstrument } from "@/lib/instruments";
import { getSymbolMapping } from "./symbol-map";
import * as fmp from "./fmp";
import * as oanda from "./oanda-market-data";
import { NormalizedCandle, NormalizedQuote, Provenance } from "../types";

function isFxRoutedThroughOanda(symbol: string): boolean {
  const instrument = getInstrument(symbol);
  const mapping = getSymbolMapping(symbol);
  return instrument?.assetClass === "Forex" && Boolean(mapping?.oandaInstrument);
}

export async function getQuote(symbol: string): Promise<Provenance<NormalizedQuote>> {
  if (!isFxRoutedThroughOanda(symbol)) return fmp.getQuote(symbol);

  const primary = await oanda.getQuote(symbol);
  if (primary.status === "live") return primary;
  const secondary = await fmp.getQuote(symbol);
  if (secondary.status === "live") return secondary;
  // Neither live-succeeded — report the primary (OANDA) attempt's result,
  // since that's the one the routing rule actually calls for; last-known-good.ts
  // reads `.error`/`.status` from this to decide whether to check storage.
  return primary;
}

export async function getDailyCandles(symbol: string, days = 260): Promise<Provenance<NormalizedCandle[]>> {
  if (!isFxRoutedThroughOanda(symbol)) return fmp.getDailyCandles(symbol, days);

  const primary = await oanda.getDailyCandles(symbol, days);
  if (primary.status === "live") return primary;
  const secondary = await fmp.getDailyCandles(symbol, days);
  if (secondary.status === "live") return secondary;
  return primary;
}

export async function getIntradayCandles(symbol: string, interval: "1hour" | "4hour"): Promise<Provenance<NormalizedCandle[]>> {
  if (!isFxRoutedThroughOanda(symbol)) return fmp.getIntradayCandles(symbol, interval);

  const oandaGranularity = interval === "1hour" ? "H1" : "H4";
  const primary = await oanda.getIntradayCandles(symbol, oandaGranularity);
  if (primary.status === "live") return primary;
  const secondary = await fmp.getIntradayCandles(symbol, interval);
  if (secondary.status === "live") return secondary;
  return primary;
}

/** The maximum-depth daily backfill — FX routes to OANDA's 5000-candle cap
 * (~18-20y); everything else uses FMP's existing 20-year default window.
 * For the one-time Seasonality backfill script only, never routine calls. */
export async function getDailyCandlesBackfill(symbol: string): Promise<Provenance<NormalizedCandle[]>> {
  if (!isFxRoutedThroughOanda(symbol)) return fmp.getDailyCandles(symbol, 20 * 365);
  return oanda.getDailyCandlesBackfill(symbol);
}
