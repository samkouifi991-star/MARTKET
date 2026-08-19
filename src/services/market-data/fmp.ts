// Financial Modeling Prep client — primary market-data provider (prices,
// candles, economic calendar, forex/stock news). Every export here is the
// only place in the app allowed to call financialmodelingprep.com; nothing
// else should construct an FMP URL.
//
// Requires FMP_API_KEY. Targets FMP's "/stable/" API base with `symbol` as a
// query parameter — the legacy "/api/v3/" base (symbol as a path segment)
// returns 403 for any account created after 2025-08-31: FMP retired v3 for
// non-legacy accounts ("Legacy Endpoint: ... only available for legacy
// users who have valid subscriptions prior August 31, 2025"). This was
// confirmed against FMP's public documentation and third-party reports of
// the same 403 (this sandbox cannot reach financialmodelingprep.com
// directly to exercise a live response) — not yet checked against an actual
// live payload. Field names below (e.g. `changePercentage` replacing v3's
// `changesPercentage`) and response shapes (bare arrays replacing v3's
// `{historical: [...]}` wrapper) are FMP's documented stable-endpoint
// contract; every parser here tries the documented name first and a
// v3-shaped fallback second rather than silently reading a wrong/missing
// field. Confirm against a real response (npm run test:fmp-coverage) before
// trusting this for any market beyond GBPUSD.
import { getSymbolMapping } from "./symbol-map";
import { errorResult, NormalizedCandle, NormalizedEconomicEvent, NormalizedNewsArticle, NormalizedQuote, Provenance, unavailable } from "../types";

const FMP_BASE = "https://financialmodelingprep.com/stable";
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

/** Stable-endpoint list responses are bare arrays; some older/legacy shapes
 * wrap them in a named property. Accept either rather than assuming one. */
function extractArray<T>(data: unknown, wrapperKeys: string[]): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    for (const key of wrapperKeys) {
      const v = (data as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export async function getQuote(internalSymbol: string): Promise<Provenance<NormalizedQuote>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping) return unavailable("fmp", SOURCE, `No FMP symbol mapping for ${internalSymbol}`);

  try {
    type FmpQuote = { symbol?: string; price?: number; changePercentage?: number; changesPercentage?: number; timestamp?: number };
    const data = await fmpGet<FmpQuote[] | FmpQuote>("/quote", { symbol: mapping.fmp.ticker });
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.price === undefined) return unavailable("fmp", SOURCE, "Empty response");

    const changePct = row.changePercentage ?? row.changesPercentage;
    if (changePct === undefined) return unavailable("fmp", SOURCE, "Quote response missing change-percentage field — FMP schema may have drifted, see file header");

    const now = new Date().toISOString();
    return {
      provider: "fmp",
      source: SOURCE,
      status: "live",
      fetchedAt: now,
      sourceUpdatedAt: row.timestamp ? new Date(row.timestamp * 1000).toISOString() : now,
      nextExpectedUpdate: null, // caller sets an appropriate cadence (see services/data-mode.ts docs, section 13)
      value: { symbol: internalSymbol, price: row.price, changePct24h: changePct, timestamp: now },
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
    type FmpBar = { date: string; open: number; high: number; low: number; close: number; volume?: number };
    const data = await fmpGet<FmpBar[] | { historical: FmpBar[] }>("/historical-price-eod/full", {
      symbol: mapping.fmp.ticker,
      from: isoDaysAgo(days + 5), // +5 buffer: `days` is trading days, the range below is calendar days
      to: isoDaysAgo(0),
    });
    const rows = extractArray<FmpBar>(data, ["historical"]);
    if (rows.length === 0) return unavailable("fmp", SOURCE, "No historical data returned");

    const candles: NormalizedCandle[] = [...rows]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) // FMP returns newest-first; sort oldest-first defensively rather than assume
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
    type FmpBar = { date: string; open: number; high: number; low: number; close: number; volume?: number };
    const data = await fmpGet<FmpBar[] | { results: FmpBar[] }>(`/historical-chart/${interval}`, { symbol: mapping.fmp.ticker });
    const rows = extractArray<FmpBar>(data, ["results"]);
    if (rows.length === 0) return unavailable("fmp", SOURCE, `No ${interval} data returned`);

    const candles: NormalizedCandle[] = [...rows]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
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
      estimate?: number | null;
      forecast?: number | null;
      impact: string | null;
    };
    const data = await fmpGet<FmpEvent[] | { events: FmpEvent[] }>("/economics-calendar", {
      from: fromISO.slice(0, 10),
      to: toISO.slice(0, 10),
    });
    const rows = extractArray<FmpEvent>(data, ["events"]);

    const events: NormalizedEconomicEvent[] = rows.map((r, i) => ({
      id: `fmp-${r.country}-${r.event}-${r.date}-${i}`,
      country: r.country,
      event: r.event,
      dateTime: new Date(r.date).toISOString(),
      impact: r.impact === "High" || r.impact === "Medium" || r.impact === "Low" ? r.impact : null,
      actual: r.actual,
      previous: r.previous,
      forecast: r.estimate ?? r.forecast ?? null,
    }));

    const now = new Date().toISOString();
    return { provider: "fmp", source: SOURCE, status: "live", fetchedAt: now, sourceUpdatedAt: now, nextExpectedUpdate: null, value: events };
  } catch (err) {
    return errorResult("fmp", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

export async function getForexAndMarketNews(limit = 50): Promise<Provenance<NormalizedNewsArticle[]>> {
  try {
    type FmpNews = { title: string; site?: string; publisher?: string; publishedDate: string; url: string; symbol?: string };
    const [forexNews, stockNews] = await Promise.all([
      fmpGet<FmpNews[] | { news: FmpNews[] }>("/forex-news", { limit: String(limit) }),
      fmpGet<FmpNews[] | { news: FmpNews[] }>("/stock-news", { limit: String(limit) }),
    ]);

    const forexRows = extractArray<FmpNews>(forexNews, ["news"]);
    const stockRows = extractArray<FmpNews>(stockNews, ["news"]);

    const articles: NormalizedNewsArticle[] = [...forexRows, ...stockRows].map((n, i) => ({
      id: `fmp-news-${i}-${n.publishedDate}`,
      headline: n.title,
      source: n.site ?? n.publisher ?? SOURCE,
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
