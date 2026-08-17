import { DataFreshness } from "@/lib/types";

export type ProviderName = "fmp" | "cftc" | "fred" | "ig" | "demo";

/** Every value pulled through the live pipeline carries this alongside its
 * normalized value, so the UI can show exactly where a number came from and
 * how fresh it is — the section-12 requirement that nothing is silently
 * substituted. `raw` is the untouched provider payload for that single
 * fetch, kept for debugging/audit, not for display. */
export type Provenance<T> = {
  provider: ProviderName;
  source: string; // human-readable, e.g. "CFTC Traders in Financial Futures"
  status: DataFreshness;
  fetchedAt: string; // ISO — when we made the request
  sourceUpdatedAt: string | null; // ISO — when the provider says the data was last published
  nextExpectedUpdate: string | null; // ISO
  value: T | null; // null when status is unavailable/error
  raw?: unknown;
  error?: string;
};

/** A structural, expected gap: the provider doesn't cover this market, isn't
 * configured, or an upstream series is intentionally unverified — never a
 * failed request. `reason` is purely descriptive, not an error signal. */
export function unavailable<T>(provider: ProviderName, source: string, reason?: string): Provenance<T> {
  return {
    provider,
    source,
    status: "unavailable",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: null,
    nextExpectedUpdate: null,
    value: null,
    error: reason,
  };
}

/** A request was actually attempted and failed (network error, non-2xx
 * response, unparseable payload) — distinct from unavailable() above. */
export function errorResult<T>(provider: ProviderName, source: string, error: string): Provenance<T> {
  return {
    provider,
    source,
    status: "error",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: null,
    nextExpectedUpdate: null,
    value: null,
    error,
  };
}

export type NormalizedQuote = {
  symbol: string;
  price: number;
  changePct24h: number;
  timestamp: string;
};

export type NormalizedCandle = {
  date: string; // ISO date, daily close
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export type NormalizedEconomicEvent = {
  id: string;
  country: string;
  event: string;
  dateTime: string;
  impact: "Low" | "Medium" | "High" | null;
  actual: number | null;
  previous: number | null;
  forecast: number | null;
};

export type NormalizedNewsArticle = {
  id: string;
  headline: string;
  source: string;
  publishedAt: string;
  url: string;
  symbols: string[]; // internal symbols the article text/tags reference
};

export type FredSeriesPoint = {
  date: string; // ISO
  value: number;
};
