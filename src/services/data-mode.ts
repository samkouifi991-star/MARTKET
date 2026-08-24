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
//
// Third-phase batch (4 of the intended 5 — see NAS100 note below):
//   AUDUSD    — FX major, AUD/USD differential (AU FRED growth/policy-rate
//               series newly verified for this batch)
//   USDCAD    — FX major, USD/CAD differential (CA FRED growth/policy-rate
//               series newly verified for this batch) — base/quote order
//               (USD base, CAD quote) uses the exact same generic
//               computeFxDifferential already proven correct by USDJPY
//               (also USD-base) in the prior batch; no new logic needed.
//   XAGUSD    — commodity, CFTC disaggregated SILVER contract (distinct
//               mapping from XAUUSD's GOLD contract, confirmed against
//               real CFTC data — the metal-scoring path is not hardcoded
//               to gold), US macro proxy, myfxbook retail sentiment
//               coverage exists (myfxbookSymbol: "XAGUSD").
//   DJ30      — equity index, CFTC financial_futures coverage under the
//               corrected "DJIA Consolidated" mapping (see symbol-map.ts),
//               US macro proxy, retail sentiment correctly NOT_APPLICABLE.
//   NAS100    — NOT added. FMP returned 402 Payment Required on both
//               /quote and /historical-price-eod/full for ^NDX (confirmed
//               via a real seed attempt, scripts/five-market-seed.ts) —
//               this FMP plan doesn't cover the Nasdaq-100 index ticker
//               (DJ30's ^DJI succeeded on the same run, so this is
//               specific to ^NDX, not a general outage). No stored price/
//               candle data exists to fall back to, so promoting it now
//               would render Price/Technical/Seasonality UNAVAILABLE with
//               no degradation path — the CFTC mapping fix alone doesn't
//               make this market viable. Needs either an FMP plan that
//               covers ^NDX or an alternative ticker before it can join a
//               live batch; the corrected "NASDAQ-100 Consolidated" CFTC
//               mapping (see symbol-map.ts) is still fixed and ready.
// Fourth-phase batch (3 markets) — OANDA wired as FX's primary price/candle
// provider (see market-data-router.ts), verified via a real end-to-end
// computeLiveMarketScore() dry run (scripts/fx-promotion-pipeline-verify.ts)
// on top of the earlier per-provider OANDA verification
// (scripts/oanda-fx-market-data-verify.ts):
//   USDCHF    — FX cross, OANDA price/Daily/H4/H1 candles verified, OANDA
//               retail sentiment verified, CFTC (CHF futures) verified, US
//               vs CH macro differential (CH FRED growth/labor series newly
//               metadata-confirmed for this batch).
//   NZDUSD    — FX cross, OANDA price/Daily/H4/H1 candles verified, OANDA
//               retail sentiment verified, CFTC (NZD futures) verified, NZ
//               vs US macro differential (NZ FRED series newly
//               metadata-confirmed for this batch).
//   GBPJPY    — FX cross, OANDA price/Daily/H4/H1 candles verified, OANDA
//               retail sentiment verified, GB vs JP macro differential.
//               Institutional Positioning correctly resolves NOT_APPLICABLE
//               (no legitimate single-leg CFTC construction for this cross)
//               rather than a fabricated value — confirmed in the real
//               pipeline dry run, and NOT_APPLICABLE does not depress
//               confidence the way UNAVAILABLE does.
//
// Fifth-phase batch (2 markets) — the two crosses held back from the fourth
// batch, promoted once a dedicated final gate
// (scripts/eurgbp-eurjpy-promotion-verify.ts) ran the exact production
// computeLiveMarketScore("live") path for both and confirmed, against real
// providers, all of: OANDA quote/Daily/H4/H1 live, a stored Neon fallback
// present, Technical Trend calculating from real OANDA candles, Seasonality
// resolving 17.7+ years of real history, OANDA Retail Sentiment live,
// Institutional Positioning and Smart Money both NOT_APPLICABLE (never a
// fabricated CFTC value), totalScore exactly equal to the sum of the
// visible factor contributions, confidence correctly reflecting the
// stale/delayed FRED macro series rather than pinning at the max, and no
// factor anywhere using demo/estimated data:
//   EURGBP    — FX cross, EU vs GB macro differential (EU FRED growth
//               series verified in the fourth batch, confirmed live in this
//               gate's real pipeline run).
//   EURJPY    — FX cross, EU vs JP macro differential (same EU FRED series;
//               JP series already verified in an earlier batch).
//
// This completes all 10 configured OANDA FX pairs — every FX market with a
// verified OANDA mapping is now STRICT_LIVE.
//
// Sixth-phase batch (4 markets) — the fourth non-FX candidate batch
// (RUT2000, FTSE100, NIKKEI225, ETHUSD), promoted after a real FMP seed +
// full computeLiveMarketScore("live") verification
// (scripts/four-market-seed-verify.ts): a real current quote, a real full
// daily-history fetch, a Neon write/read-back round-trip for both, and the
// real factor pipeline all confirmed for each symbol — never a demo value.
//   RUT2000   — equity index, real US macro, and the only one of the four
//               with a genuine CFTC-reportable contract ("RUSSELL E-MINI"),
//               so Institutional Positioning/Smart Money resolve real
//               values here, not NOT_APPLICABLE.
//   FTSE100   — equity index, real GB macro (Bank of England rate, not the
//               Fed). No CFTC-reportable contract for this index under the
//               current methodology, so Institutional Positioning/Smart
//               Money correctly resolve NOT_APPLICABLE — this does not
//               depress confidence the way UNAVAILABLE does.
//   NIKKEI225 — equity index, real JP macro. Same NOT_APPLICABLE CFTC/Smart
//               Money treatment as FTSE100, for the same structural reason.
//   ETHUSD    — crypto, US macro used explicitly as a Global Liquidity
//               Macro Proxy (same convention already proven by BTCUSD), not
//               a fabricated country model. No CFTC-reportable contract and
//               no myfxbook/IG/OANDA retail-sentiment mapping, so
//               Institutional Positioning, Smart Money, and Retail
//               Sentiment all correctly resolve NOT_APPLICABLE.
// All four: FMP's intraday (H4/H1) endpoints return 402 Payment Required on
// this plan for every one of these tickers, so Technical Trend legitimately
// reports DELAYED (daily candles only, real, live) rather than an
// artificially-inflated LIVE — this is expected, correct behavior, not a
// defect to chase. The News factor is unavailable for all four (a systemic
// FMP news-endpoint gap affecting every market in this system equally, not
// specific to these four) — News has no demo fallback and, being an
// ordinary UNAVAILABLE factor rather than a promotion blocker, does not
// prevent these markets from being real, live, and promotable.
const STRICT_LIVE_SYMBOLS = new Set<string>([
  "GBPUSD",
  "EURUSD",
  "USDJPY",
  "XAUUSD",
  "BTCUSD",
  "SPX500",
  "AUDUSD",
  "USDCAD",
  "XAGUSD",
  "DJ30",
  "RUT2000",
  "FTSE100",
  "NIKKEI225",
  "ETHUSD",
  "USDCHF",
  "NZDUSD",
  "GBPJPY",
  "EURGBP",
  "EURJPY",
]);

export function isStrictLiveSymbol(symbol: string): boolean {
  return STRICT_LIVE_SYMBOLS.has(symbol);
}

// The single source of truth for "every currently-promoted strict-live
// symbol" as an iterable list — derived from the same Set above rather than
// duplicated, for callers (the admin reweight recompute) that need to loop
// over all of them rather than test one.
export function strictLiveSymbolList(): string[] {
  return Array.from(STRICT_LIVE_SYMBOLS);
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
