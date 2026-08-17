// Financial Modeling Prep client — primary market-data provider (prices,
// candles, economic calendar, forex/stock news). Every export here is the
// only place in the app allowed to call financialmodelingprep.com; nothing
// else should construct an FMP URL.
//
// Requires FMP_API_KEY. Endpoints target FMP's v3 REST API — the most
// broadly documented, longest-supported surface at the time this was
// written. FMP has periodically introduced a newer "/stable/" base for some
// endpoints; confirm current endpoint paths against
// https://site.financialmodelingprep.com/developer/docs before going live,
// since provider APIs do drift.
import { getSymbolMapping } from "./symbol-map";
import { errorResult, NormalizedCandle, NormalizedEconomicEvent, NormalizedNewsArticle, NormalizedQuote, Provenance, unavailable } from "../types";

const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const SOURCE = "Financial Modeling Prep";

function apiKey(): string | null {
  return process.env.FMP_API_KEY?.trim() || null;
}

async function fmpGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("FMP_API_KEY is not configured");
  const url = new URL(`${FMP_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(`FMP request failed: ${res.status} ${res.statusText} (${path})`);
  }
  return (await res.json()) as T;
}

export async function getQuote(internalSymbol: string): Promise<Provenance<NormalizedQuote>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping) return unavailable("fmp", SOURCE, `No FMP symbol mapping for ${internalSymbol}`);

  try {
    type FmpQuote = { symbol: string; price: number; changesPercentage: number; timestamp?: number };
    const rows = await fmpGet<FmpQuote[]>(`/quote/${encodeURIComponent(mapping.fmp.ticker)}`);
    const row = rows[0];
    if (!row) return unavailable("fmp", SOURCE, "Empty response");

    const now = new Date().toISOString();
    return {
      provider: "fmp",
      source: SOURCE,
      status: "live",
      fetchedAt: now,
      sourceUpdatedAt: row.timestamp ? new Date(row.timestamp * 1000).toISOString() : now,
      nextExpectedUpdate: null, // caller sets an appropriate cadence (see services/data-mode.ts docs, section 13)
      value: { symbol: internalSymbol, price: row.price, changePct24h: row.changesPercentage, timestamp: now },
      raw: row,
    };
  } catch (err) {
    return errorResult("fmp", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

export async function getDailyCandles(internalSymbol: string, days = 260): Promise<Provenance<NormalizedCandle[]>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping) return unavailable("fmp", SOURCE, `No FMP symbol mapping for ${internalSymbol}`);

  try {
    type FmpHistorical = { historical: { date: string; open: number; high: number; low: number; close: number; volume: number }[] };
    const data = await fmpGet<FmpHistorical>(`/historical-price-full/${encodeURIComponent(mapping.fmp.ticker)}`, {
      timeseries: String(days),
    });
    if (!data.historical?.length) return unavailable("fmp", SOURCE, "No historical data returned");

    const candles: NormalizedCandle[] = [...data.historical]
      .reverse() // FMP returns newest-first; the app expects oldest-first
      .map((h) => ({
        date: new Date(h.date).toISOString(),
        open: h.open,
        high: h.high,
        low: h.low,
        close: h.close,
        volume: h.volume ?? null,
      }));

    const now = new Date().toISOString();
    return {
      provider: "fmp",
      source: SOURCE,
      status: "live",
      fetchedAt: now,
      sourceUpdatedAt: candles[candles.length - 1]?.date ?? now,
      nextExpectedUpdate: null,
      value: candles,
    };
  } catch (err) {
    return errorResult("fmp", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

export async function getIntradayCandles(internalSymbol: string, interval: "1hour" | "4hour"): Promise<Provenance<NormalizedCandle[]>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping) return unavailable("fmp", SOURCE, `No FMP symbol mapping for ${internalSymbol}`);

  try {
    type FmpIntraday = { date: string; open: number; high: number; low: number; close: number; volume: number }[];
    const data = await fmpGet<FmpIntraday>(`/historical-chart/${interval}/${encodeURIComponent(mapping.fmp.ticker)}`);
    if (!data?.length) return unavailable("fmp", SOURCE, `No ${interval} data returned`);

    const candles: NormalizedCandle[] = [...data]
      .reverse() // FMP returns newest-first
      .map((h) => ({ date: new Date(h.date).toISOString(), open: h.open, high: h.high, low: h.low, close: h.close, volume: h.volume ?? null }));

    const now = new Date().toISOString();
    return {
      provider: "fmp",
      source: SOURCE,
      status: "live",
      fetchedAt: now,
      sourceUpdatedAt: candles[candles.length - 1]?.date ?? now,
      nextExpectedUpdate: null,
      value: candles,
    };
  } catch (err) {
    return errorResult("fmp", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

export async function getEconomicCalendar(fromISO: string, toISO: string): Promise<Provenance<NormalizedEconomicEvent[]>> {
  try {
    type FmpEvent = {
      event: string;
      date: string;
      country: string;
      actual: number | null;
      previous: number | null;
      estimate: number | null;
      impact: string | null;
    };
    const rows = await fmpGet<FmpEvent[]>("/economic_calendar", {
      from: fromISO.slice(0, 10),
      to: toISO.slice(0, 10),
    });

    const events: NormalizedEconomicEvent[] = rows.map((r, i) => ({
      id: `fmp-${r.country}-${r.event}-${r.date}-${i}`,
      country: r.country,
      event: r.event,
      dateTime: new Date(r.date).toISOString(),
      impact: r.impact === "High" || r.impact === "Medium" || r.impact === "Low" ? r.impact : null,
      actual: r.actual,
      previous: r.previous,
      forecast: r.estimate,
    }));

    const now = new Date().toISOString();
    return { provider: "fmp", source: SOURCE, status: "live", fetchedAt: now, sourceUpdatedAt: now, nextExpectedUpdate: null, value: events };
  } catch (err) {
    return errorResult("fmp", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

export async function getForexAndMarketNews(limit = 50): Promise<Provenance<NormalizedNewsArticle[]>> {
  try {
    type FmpNews = { title: string; site: string; publishedDate: string; url: string; symbol?: string };
    const [forexNews, stockNews] = await Promise.all([
      fmpGet<FmpNews[]>("/forex_news", { limit: String(limit) }),
      fmpGet<FmpNews[]>("/stock_news", { limit: String(limit) }),
    ]);

    const articles: NormalizedNewsArticle[] = [...forexNews, ...stockNews].map((n, i) => ({
      id: `fmp-news-${i}-${n.publishedDate}`,
      headline: n.title,
      source: n.site,
      publishedAt: new Date(n.publishedDate).toISOString(),
      url: n.url,
      symbols: n.symbol ? [n.symbol] : [],
    }));

    const now = new Date().toISOString();
    return { provider: "fmp", source: SOURCE, status: "live", fetchedAt: now, sourceUpdatedAt: now, nextExpectedUpdate: null, value: articles };
  } catch (err) {
    return errorResult("fmp", SOURCE, err instanceof Error ? err.message : String(err));
  }
}
