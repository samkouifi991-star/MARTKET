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
import { cached } from "./request-cache";

const FMP_BASE = "https://financialmodelingprep.com/stable";
const SOURCE = "Financial Modeling Prep";

// Cache TTLs — see request-cache.ts. Values match the cadence the data
// actually changes at, not how often a page might render: quotes move by
// the minute, daily candles only grow once a day, intraday candles only as
// often as a new bar forms, news within a loose window, and we never want
// to re-download 19+ years of daily history on every render.
const QUOTE_TTL_MS = 3 * 60_000; // ~3 min
const DAILY_CANDLES_TTL_MS = 6 * 60 * 60_000; // ~6h — the latest daily bar only changes once/day
const H1_CANDLES_TTL_MS = 60 * 60_000; // ~1h — refresh roughly once per new 1H bar
const H4_CANDLES_TTL_MS = 4 * 60 * 60_000; // ~4h — refresh roughly once per new 4H bar
const NEWS_TTL_MS = 10 * 60_000; // ~10 min
const CALENDAR_TTL_MS = 30 * 60_000; // ~30 min

function apiKey(): string | null {
  return process.env.FMP_API_KEY?.trim() || null;
}

/** Carries the HTTP status so callers can distinguish "your plan doesn't
 * include this endpoint" (402) from a rate limit (429) from a genuine
 * request failure. 402 is a structural/expected gap for this account, not
 * an error to retry or alarm on. 429 is transient and must back off, never
 * be retried immediately. `retryAfterSeconds` carries FMP's own Retry-After
 * header when present, or our own backoff estimate otherwise. */
class FmpHttpError extends Error {
  constructor(
    public status: number,
    statusText: string,
    path: string,
    public retryAfterSeconds: number | null = null
  ) {
    super(`FMP request failed: ${status} ${statusText} (${path})`);
  }
}

// Per-endpoint-path circuit breaker: once FMP returns 429 for a path, every
// caller (any component, any part of the page) is blocked from hitting that
// path again until the backoff window clears — a cheap in-memory check, no
// network call — instead of each independently retrying and extending the
// rate-limit penalty. Consecutive 429s widen the backoff exponentially
// (capped) with jitter so many warm instances don't all retry in lockstep.
// Resets on the next real success. Same honest limitation as
// request-cache.ts: module-level state, reliable within an execution and
// opportunistically shared on a warm instance, empty on cold start.
type RateLimitState = { blockedUntil: number; consecutive429s: number };
const rateLimitState = new Map<string, RateLimitState>();

const BASE_BACKOFF_SECONDS = 15;
const MAX_BACKOFF_SECONDS = 300;

function withJitter(seconds: number): number {
  const jitter = seconds * (Math.random() * 0.4 - 0.2); // +/-20%
  return Math.max(1, Math.round(seconds + jitter));
}

async function fmpGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("FMP_API_KEY is not configured");

  const state = rateLimitState.get(path);
  if (state && state.blockedUntil > Date.now()) {
    throw new FmpHttpError(429, "Too Many Requests (backing off, not retried yet)", path, Math.ceil((state.blockedUntil - Date.now()) / 1000));
  }

  const url = new URL(`${FMP_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });

  if (res.status === 429) {
    const consecutive429s = (state?.consecutive429s ?? 0) + 1;
    const retryAfterHeader = Number(res.headers.get("retry-after"));
    const backoffSeconds =
      Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader
        : withJitter(Math.min(BASE_BACKOFF_SECONDS * 2 ** (consecutive429s - 1), MAX_BACKOFF_SECONDS));
    rateLimitState.set(path, { blockedUntil: Date.now() + backoffSeconds * 1000, consecutive429s });
    throw new FmpHttpError(429, res.statusText, path, Math.ceil(backoffSeconds));
  }

  if (!res.ok) {
    throw new FmpHttpError(res.status, res.statusText, path);
  }

  rateLimitState.delete(path);
  return (await res.json()) as T;
}

function isPlanLimited(err: unknown): boolean {
  return err instanceof FmpHttpError && err.status === 402;
}

function isRateLimited(err: unknown): boolean {
  return err instanceof FmpHttpError && err.status === 429;
}

/** Distinguishes RATE_LIMITED from a generic error in the reason string so
 * the UI and provenance record can tell "FMP is throttling us right now"
 * apart from "something is actually broken" — never classified as ERROR. */
function rateLimitMessage(err: unknown): string {
  const retryAfter = err instanceof FmpHttpError ? err.retryAfterSeconds : null;
  return retryAfter
    ? `RATE_LIMITED — FMP returned 429 Too Many Requests, retry after ~${retryAfter}s`
    : "RATE_LIMITED — FMP returned 429 Too Many Requests";
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

// Future multi-symbol note (do not implement yet — GBPUSD only for now):
// once more markets go live, prices/route.ts's per-symbol loop should be
// replaced with FMP's batch forex quote endpoint (one request covering many
// tickers) rather than N individual getQuote() calls — the natural next
// consumer of this file's cache/coalescing layer. getQuote() itself would
// stay as the single-symbol entry point (still used by on-demand market
// pages); a getBatchQuotes(symbols) sibling would populate the same
// request-cache keys (`fmp:quote:${ticker}`) so a page that then calls
// getQuote() for one of those symbols gets a cache hit instead of a
// redundant request.
export async function getQuote(internalSymbol: string): Promise<Provenance<NormalizedQuote>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping) return unavailable("fmp", SOURCE, `No FMP symbol mapping for ${internalSymbol}`);

  try {
    return await cached(`fmp:quote:${mapping.fmp.ticker}`, QUOTE_TTL_MS, async () => {
      type FmpQuote = { symbol?: string; price?: number; changePercentage?: number; changesPercentage?: number; timestamp?: number };
      const data = await fmpGet<FmpQuote[] | FmpQuote>("/quote", { symbol: mapping.fmp.ticker });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.price === undefined) throw new Error("Empty response");

      const changePct = row.changePercentage ?? row.changesPercentage;
      if (changePct === undefined) throw new Error("Quote response missing change-percentage field — FMP schema may have drifted, see file header");

      const now = new Date().toISOString();
      const result: Provenance<NormalizedQuote> = {
        provider: "fmp",
        source: SOURCE,
        status: "live",
        fetchedAt: now,
        sourceUpdatedAt: row.timestamp ? new Date(row.timestamp * 1000).toISOString() : now,
        nextExpectedUpdate: null, // caller sets an appropriate cadence (see services/data-mode.ts docs, section 13)
        value: { symbol: internalSymbol, price: row.price, changePct24h: changePct, timestamp: now },
        raw: row,
      };
      return result;
    });
  } catch (err) {
    if (isRateLimited(err)) return unavailable("fmp", SOURCE, rateLimitMessage(err));
    if (err instanceof Error && (err.message === "Empty response" || err.message.startsWith("Quote response missing"))) {
      return unavailable("fmp", SOURCE, err.message);
    }
    return errorResult("fmp", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

export async function getDailyCandles(internalSymbol: string, days = 260): Promise<Provenance<NormalizedCandle[]>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping) return unavailable("fmp", SOURCE, `No FMP symbol mapping for ${internalSymbol}`);

  try {
    // Keyed by ticker+days so every caller asking for the same window
    // (Technical Trend, Seasonality, the price chart, historical
    // calculations, this validation page) shares one fetch instead of each
    // independently re-downloading the full daily history.
    return await cached(`fmp:daily:${mapping.fmp.ticker}:${days}`, DAILY_CANDLES_TTL_MS, async () => {
      type FmpBar = { date: string; open: number; high: number; low: number; close: number; volume?: number };
      const data = await fmpGet<FmpBar[] | { historical: FmpBar[] }>("/historical-price-eod/full", {
        symbol: mapping.fmp.ticker,
        from: isoDaysAgo(days + 5), // +5 buffer: `days` is trading days, the range below is calendar days
        to: isoDaysAgo(0),
      });
      const rows = extractArray<FmpBar>(data, ["historical"]);
      if (rows.length === 0) throw new Error("No historical data returned");

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
      const result: Provenance<NormalizedCandle[]> = {
        provider: "fmp",
        source: SOURCE,
        status: "live",
        fetchedAt: now,
        sourceUpdatedAt: candles[candles.length - 1]?.date ?? now,
        nextExpectedUpdate: null,
        value: candles,
      };
      return result;
    });
  } catch (err) {
    if (isRateLimited(err)) return unavailable("fmp", SOURCE, rateLimitMessage(err));
    if (err instanceof Error && err.message === "No historical data returned") return unavailable("fmp", SOURCE, err.message);
    return errorResult("fmp", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

/** FMP returns 402 Payment Required (not 401/403) for an endpoint above the
 * caller's plan tier — a structural, expected gap for that account, not a
 * failed request. Reported this way so callers (technical.ts) can degrade
 * to daily-only rather than treating it as a transient error. */
export async function getIntradayCandles(internalSymbol: string, interval: "1hour" | "4hour"): Promise<Provenance<NormalizedCandle[]>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping) return unavailable("fmp", SOURCE, `No FMP symbol mapping for ${internalSymbol}`);

  const ttl = interval === "1hour" ? H1_CANDLES_TTL_MS : H4_CANDLES_TTL_MS;

  try {
    // A 402 plan-limitation is cached too (as an `unavailable` result, not
    // thrown) — it's a structural, effectively-permanent gap for this
    // account, so re-hitting FMP for it every render would waste rate-limit
    // budget on a request that can never succeed this session.
    return await cached(`fmp:intraday:${interval}:${mapping.fmp.ticker}`, ttl, async () => {
      type FmpBar = { date: string; open: number; high: number; low: number; close: number; volume?: number };
      try {
        const data = await fmpGet<FmpBar[] | { results: FmpBar[] }>(`/historical-chart/${interval}`, { symbol: mapping.fmp.ticker });
        const rows = extractArray<FmpBar>(data, ["results"]);
        if (rows.length === 0) return unavailable<NormalizedCandle[]>("fmp", SOURCE, `No ${interval} data returned`);

        const candles: NormalizedCandle[] = [...rows]
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
          .map((h) => ({ date: new Date(h.date).toISOString(), open: h.open, high: h.high, low: h.low, close: h.close, volume: h.volume ?? null }));

        const now = new Date().toISOString();
        const result: Provenance<NormalizedCandle[]> = {
          provider: "fmp",
          source: SOURCE,
          status: "live",
          fetchedAt: now,
          sourceUpdatedAt: candles[candles.length - 1]?.date ?? now,
          nextExpectedUpdate: null,
          value: candles,
        };
        return result;
      } catch (err) {
        if (isPlanLimited(err)) return unavailable<NormalizedCandle[]>("fmp", SOURCE, `provider plan does not include intraday candles (${interval})`);
        throw err; // rate-limited / genuine errors: don't cache, classify in the outer catch
      }
    });
  } catch (err) {
    if (isRateLimited(err)) return unavailable("fmp", SOURCE, rateLimitMessage(err));
    return errorResult("fmp", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

export async function getEconomicCalendar(fromISO: string, toISO: string): Promise<Provenance<NormalizedEconomicEvent[]>> {
  const from = fromISO.slice(0, 10);
  const to = toISO.slice(0, 10);

  try {
    return await cached(`fmp:calendar:${from}:${to}`, CALENDAR_TTL_MS, async () => {
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
      const data = await fmpGet<FmpEvent[] | { events: FmpEvent[] }>("/economics-calendar", { from, to });
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
      const result: Provenance<NormalizedEconomicEvent[]> = {
        provider: "fmp",
        source: SOURCE,
        status: "live",
        fetchedAt: now,
        sourceUpdatedAt: now,
        nextExpectedUpdate: null,
        value: events,
      };
      return result;
    });
  } catch (err) {
    if (isRateLimited(err)) return unavailable("fmp", SOURCE, rateLimitMessage(err));
    return errorResult("fmp", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

type FmpNews = { title: string; site?: string; publisher?: string; publishedDate: string; url: string; symbol?: string };

async function fetchNewsLeg(path: string, limit: number): Promise<FmpNews[]> {
  // Cached per path+limit so Technical Trend / market pages / this
  // validation page reuse the same news fetch instead of each re-hitting
  // FMP within the same short window.
  return cached(`fmp:news:${path}:${limit}`, NEWS_TTL_MS, async () => {
    const data = await fmpGet<FmpNews[] | { news: FmpNews[] }>(path, { limit: String(limit) });
    return extractArray<FmpNews>(data, ["news"]);
  });
}

export async function getForexAndMarketNews(limit = 50): Promise<Provenance<NormalizedNewsArticle[]>> {
  // Fetched independently: a broken/renamed endpoint on one leg (this is
  // exactly what happened to forex-news, moved to /news/forex-latest under
  // FMP's stable API) must not take down the other, which may still be
  // working fine.
  const [forex, stock] = await Promise.allSettled([fetchNewsLeg("/news/forex-latest", limit), fetchNewsLeg("/stock-news", limit)]);

  if (forex.status === "rejected" && stock.status === "rejected") {
    if (isRateLimited(forex.reason) || isRateLimited(stock.reason)) {
      return unavailable("fmp", SOURCE, rateLimitMessage(isRateLimited(forex.reason) ? forex.reason : stock.reason));
    }
    if (isPlanLimited(forex.reason) || isPlanLimited(stock.reason)) {
      return unavailable("fmp", SOURCE, "provider plan does not include this news endpoint");
    }
    return errorResult("fmp", SOURCE, forex.reason instanceof Error ? forex.reason.message : String(forex.reason));
  }

  const rows = [...(forex.status === "fulfilled" ? forex.value : []), ...(stock.status === "fulfilled" ? stock.value : [])];
  const articles: NormalizedNewsArticle[] = rows.map((n, i) => ({
    id: `fmp-news-${i}-${n.publishedDate}`,
    headline: n.title,
    source: n.site ?? n.publisher ?? SOURCE,
    publishedAt: new Date(n.publishedDate).toISOString(),
    url: n.url,
    symbols: n.symbol ? [n.symbol] : [],
  }));

  const now = new Date().toISOString();
  return { provider: "fmp", source: SOURCE, status: "live", fetchedAt: now, sourceUpdatedAt: now, nextExpectedUpdate: null, value: articles };
}
