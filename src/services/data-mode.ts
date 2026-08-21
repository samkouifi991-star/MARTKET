// Central switch for how the app sources data. Every consumer (scoring
// engine, page components, admin health screen) reads through here rather
// than checking process.env directly, so there is exactly one place that
// decides demo vs. live behavior.
//
//   demo   — current deterministic demo-data generators only (default; this
//            is what's live in production today and what ships until every
//            tracked market is verified against real providers).
//   hybrid — real providers are called where credentials exist; any factor
//            whose provider isn't configured or fails falls back to demo
//            data, but is flagged as demo in its provenance so the UI can
//            show it honestly instead of pretending it's live. Intended for
//            development/staging only.
//   live   — real providers only. A missing/failing provider must render
//            "Data temporarily unavailable" (or "Retail sentiment
//            unavailable" for that specific factor) and lower confidence —
//            never a fabricated or demo value.
export type DataMode = "demo" | "hybrid" | "live";

function readDataMode(): DataMode {
  const raw = (process.env.DATA_MODE ?? "demo").toLowerCase().trim();
  if (raw === "live" || raw === "hybrid") return raw;
  return "demo";
}

export const DATA_MODE: DataMode = readDataMode();

export function isDemoOnly(): boolean {
  return DATA_MODE === "demo";
}

export function allowsLiveProviders(): boolean {
  return DATA_MODE === "live" || DATA_MODE === "hybrid";
}

// GBPUSD is the live reference market: it must prove the real pipeline end
// to end, so hybrid mode's usual "fall back to demo, but flag it" leniency
// is deliberately withheld for it. A strict-live symbol that hits a missing
// or failed provider goes straight to unavailable/error, same as live mode,
// so it's never possible to mistake a demo factor for a real one.
// Add a symbol here only once it is being actively verified end-to-end.
//
// Second-phase batch (5 markets, added together after individually
// verifying FMP/CFTC/FRED/retail-sentiment mappings and seeding real
// stored data — see scripts/five-market-verify.ts and the FRED/CFTC
// verification scripts' real-API output):
//   EURUSD    — FX major, EUR/USD two-country macro differential (EU FRED
//               series newly verified for this batch)
//   USDJPY    — FX major, USD/JPY differential (JP FRED series newly
//               verified for this batch)
//   XAUUSD    — commodity, CFTC disaggregated coverage, US macro proxy
//   BTCUSD    — crypto, CFTC financial_futures (CME) coverage, US macro
//               proxy, retail sentiment correctly NOT_APPLICABLE (no
//               Myfxbook/IG coverage for crypto)
//   SPX500    — equity index, CFTC financial_futures (E-mini) coverage, US
//               macro proxy, retail sentiment correctly NOT_APPLICABLE (no
//               Myfxbook/IG coverage for indices)
const STRICT_LIVE_SYMBOLS = new Set<string>(["GBPUSD", "EURUSD", "USDJPY", "XAUUSD", "BTCUSD", "SPX500"]);

export function isStrictLiveSymbol(symbol: string): boolean {
  return STRICT_LIVE_SYMBOLS.has(symbol);
}

/** In live mode — or hybrid mode for a strict-live symbol — a missing
 * provider must surface as unavailable, never fall back to demo data.
 * Takes `mode` explicitly (the same per-call value resolvers already
 * receive from computeLiveMarketScore) rather than reading the module-level
 * DATA_MODE constant, so this stays correct under test and for any future
 * caller that computes a score for an explicit mode different from the
 * process-wide default. */
export function allowsDemoFallback(mode: DataMode, symbol: string): boolean {
  return mode === "hybrid" && !isStrictLiveSymbol(symbol);
}
