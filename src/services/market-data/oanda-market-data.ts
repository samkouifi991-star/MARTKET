// OANDA v20 REST API — FX price/candle market data. A deliberately SEPARATE
// module from retail-sentiment/oanda.ts (which only ever touches
// PositionBook) even though both call the same OANDA account — kept
// independent per explicit instruction rather than merged just because
// they share a vendor. Nothing outside this file should construct an OANDA
// pricing/candles URL.
//
// Wired into the live pipeline as the primary provider for the 10
// configured FX pairs (see market-data-router.ts), FMP as fallback. The
// response shapes below matched a real, independently confirmed
// production OANDA v20 response the first time this module ran in
// production — scripts/oanda-fx-market-data-verify.ts was the controlled
// first real test before that promotion; this sandbox itself still
// cannot reach api-fxpractice.oanda.com directly, so any further field-
// shape questions must be verified against real production behavior
// (see the ingestion-diagnostic GitHub Actions workflow), not guessed.
//
// Endpoints used:
//   GET /v3/instruments/{instrument}/candles?granularity=D|H1|H4 — candles.
//     Instrument-level, needs only OANDA_API_TOKEN, no account ID.
//   GET /v3/accounts/{accountID}/pricing?instruments=X — current price. The
//     only OANDA endpoint here that is account-scoped (pricing reflects
//     what a specific account is actually quoted); requires
//     OANDA_ACCOUNT_ID. If unset, getQuote reports unavailable but the
//     candle functions below keep working independently.
import { getSymbolMapping } from "./symbol-map";
import { errorResult, NormalizedCandle, NormalizedQuote, Provenance, unavailable } from "../types";

const SOURCE = "OANDA v20";

function baseUrl(): string {
  return process.env.OANDA_ENVIRONMENT === "live" ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com";
}

function apiTokenConfigured(): boolean {
  return Boolean(process.env.OANDA_API_TOKEN);
}

function accountConfigured(): boolean {
  return Boolean(process.env.OANDA_API_TOKEN && process.env.OANDA_ACCOUNT_ID);
}

// Token is sent only as an outbound Authorization header, never logged and
// never echoed into any returned/printed value.
function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.OANDA_API_TOKEN}` };
}

type OandaGranularity = "D" | "H1" | "H4";
type OandaCandle = { complete: boolean; volume: number; time: string; mid?: { o: string; h: string; l: string; c: string } };
type OandaCandlesResponse = { candles?: OandaCandle[]; granularity?: string; instrument?: string; errorMessage?: string };

function toNormalizedCandles(raw: OandaCandle[]): NormalizedCandle[] {
  return raw
    // Exclude the still-forming current bar (complete: false) — a "candle"
    // means a closed period here, same meaning FMP's historical rows have.
    .filter((c) => c.complete && c.mid)
    .map((c) => ({ date: c.time, open: Number(c.mid!.o), high: Number(c.mid!.h), low: Number(c.mid!.l), close: Number(c.mid!.c), volume: c.volume ?? null }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // OANDA returns oldest-first already, but never assume
}

async function fetchCandles(instrument: string, granularity: OandaGranularity, count: number): Promise<OandaCandlesResponse> {
  const url = new URL(`${baseUrl()}/v3/instruments/${encodeURIComponent(instrument)}/candles`);
  url.searchParams.set("granularity", granularity);
  url.searchParams.set("count", String(count));
  url.searchParams.set("price", "M"); // mid prices — matches the single OHLC series FMP/NormalizedCandle already assume
  if (granularity === "D") {
    // OANDA defaults a daily bar's boundary to 17:00 America/New_York, so an
    // unqualified request timestamps "today's" daily candle roughly 21-22h
    // before FMP's date-only ("YYYY-MM-DD" -> parsed as UTC midnight) bar
    // for the same trading day. getLatestStoredCandles picks whichever
    // stored candle has the greatest `date` across BOTH providers — with
    // that systematic offset, a genuinely fresher OANDA candle can sort
    // behind an older FMP fallback row. Forcing UTC/midnight alignment here
    // makes OANDA's daily `time` directly comparable to FMP's.
    url.searchParams.set("alignmentTimezone", "UTC");
    url.searchParams.set("dailyAlignment", "0");
  }
  const res = await fetch(url.toString(), { headers: authHeaders(), next: { revalidate: 0 } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OANDA candles request failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`);
  }
  return (await res.json()) as OandaCandlesResponse;
}

async function getCandlesResult(internalSymbol: string, granularity: OandaGranularity, count: number): Promise<Provenance<NormalizedCandle[]>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping?.oandaInstrument) return unavailable("oanda", SOURCE, `OANDA does not have a confirmed FX instrument mapping for ${internalSymbol}`);
  if (!apiTokenConfigured()) return unavailable("oanda", SOURCE, "OANDA_API_TOKEN not configured");

  try {
    const data = await fetchCandles(mapping.oandaInstrument, granularity, count);
    const candles = toNormalizedCandles(data.candles ?? []);
    if (candles.length === 0) return unavailable("oanda", SOURCE, `OANDA returned no completed ${granularity} candles for ${mapping.oandaInstrument}`);

    const now = new Date().toISOString();
    return {
      provider: "oanda",
      source: SOURCE,
      status: "live",
      fetchedAt: now,
      sourceUpdatedAt: candles[candles.length - 1].date,
      nextExpectedUpdate: null,
      value: candles,
      raw: data,
    };
  } catch (err) {
    return errorResult("oanda", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

/** Daily candles for a bounded recent window — mirrors fmp.getDailyCandles's
 * signature (days of history) so this can slot into the same call sites
 * later. `days` is a trading-day count, same convention FMP already uses. */
export async function getDailyCandles(internalSymbol: string, days = 260): Promise<Provenance<NormalizedCandle[]>> {
  return getCandlesResult(internalSymbol, "D", Math.min(5000, days + 10));
}

/** Maximum daily history available in a single request — OANDA's absolute
 * per-request cap is 5000 candles (~19-20 years of daily FX bars). Intended
 * for a one-time-per-market Seasonality backfill, not routine requests —
 * callers must not invoke this on every build or page render. */
export async function getDailyCandlesBackfill(internalSymbol: string): Promise<Provenance<NormalizedCandle[]>> {
  return getCandlesResult(internalSymbol, "D", 5000);
}

/** H1/H4 candles for Technical Trend's intraday confirmation — 500 bars is
 * far more than the indicator windows (SMA/RSI/ADX) need, while staying a
 * single cheap request. */
export async function getIntradayCandles(internalSymbol: string, interval: "H1" | "H4"): Promise<Provenance<NormalizedCandle[]>> {
  return getCandlesResult(internalSymbol, interval, 500);
}

type OandaPricingRow = { instrument: string; time: string; closeoutBid?: string; closeoutAsk?: string; bids?: { price: string }[]; asks?: { price: string }[] };
type OandaPricingResponse = { prices?: OandaPricingRow[]; errorMessage?: string };

export async function getQuote(internalSymbol: string): Promise<Provenance<NormalizedQuote>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping?.oandaInstrument) return unavailable("oanda", SOURCE, `OANDA does not have a confirmed FX instrument mapping for ${internalSymbol}`);
  if (!accountConfigured()) {
    return unavailable("oanda", SOURCE, "OANDA_ACCOUNT_ID (and/or OANDA_API_TOKEN) not configured — pricing is account-scoped in OANDA's v20 API, unlike candles");
  }

  try {
    const url = new URL(`${baseUrl()}/v3/accounts/${encodeURIComponent(process.env.OANDA_ACCOUNT_ID!)}/pricing`);
    url.searchParams.set("instruments", mapping.oandaInstrument);
    const res = await fetch(url.toString(), { headers: authHeaders(), next: { revalidate: 0 } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OANDA pricing request failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`);
    }

    const data = (await res.json()) as OandaPricingResponse;
    const row = data.prices?.[0];
    const bid = row?.closeoutBid !== undefined ? Number(row.closeoutBid) : row?.bids?.[0] ? Number(row.bids[0].price) : undefined;
    const ask = row?.closeoutAsk !== undefined ? Number(row.closeoutAsk) : row?.asks?.[0] ? Number(row.asks[0].price) : undefined;
    if (bid === undefined || ask === undefined || Number.isNaN(bid) || Number.isNaN(ask)) {
      return unavailable("oanda", SOURCE, `OANDA pricing response missing bid/ask for ${mapping.oandaInstrument}`);
    }
    const price = (bid + ask) / 2;

    // changePct24h isn't part of the pricing payload — compute it honestly
    // from the last completed daily candle's close vs. this price, rather
    // than omitting the field or fabricating a number.
    const priorDay = await getCandlesResult(internalSymbol, "D", 2);
    const priorClose = priorDay.value?.[priorDay.value.length - 1]?.close;
    const changePct24h = priorClose ? ((price - priorClose) / priorClose) * 100 : 0;

    const now = new Date().toISOString();
    return {
      provider: "oanda",
      source: SOURCE,
      status: "live",
      fetchedAt: now,
      sourceUpdatedAt: row?.time ?? now,
      nextExpectedUpdate: null,
      value: { symbol: internalSymbol, price, changePct24h, timestamp: row?.time ?? now },
      raw: row,
    };
  } catch (err) {
    return errorResult("oanda", SOURCE, err instanceof Error ? err.message : String(err));
  }
}
