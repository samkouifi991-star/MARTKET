import { describe, expect, it, vi, beforeEach } from "vitest";
import { getTableName, Table } from "drizzle-orm";
import { marketCandles } from "../schema";

let selectResults: Record<string, unknown[]> = {};

function isSqlFragment(v: unknown): boolean {
  // upsertCandles' onConflictDoUpdate uses sql`excluded.column` markers for
  // real Postgres ON CONFLICT semantics — this fake resolves each marker to
  // that row's own field, mirroring what Postgres's `excluded` pseudo-table
  // actually does per conflicting row (same pattern as current-score.test.ts).
  return typeof v === "object" && v !== null && !(v instanceof Date);
}

// Mirrors this repo's established db-query test pattern (see
// release-tracking.test.ts) — a fake chainable select keyed by table name,
// plus a fake insert/onConflictDoUpdate for marketCandles specifically
// (upsertCandles is the only writer exercised by this file's tests).
vi.mock("../client", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: Table) => makeQuery(selectResults[getTableName(table)] ?? []),
    }),
    insert: (table: unknown) => ({
      values: (v: unknown) => {
        const rows = (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
        return {
          onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
            if (table !== marketCandles) return Promise.resolve();
            const store = (selectResults.market_candles ??= []) as Record<string, unknown>[];
            const keyOf = (r: Record<string, unknown>) => `${r.symbol}:${r.timeframe}:${(r.date as Date).toISOString()}`;
            for (const row of rows) {
              const resolved: Record<string, unknown> = { ...row };
              for (const [k, sv] of Object.entries(set)) {
                resolved[k] = isSqlFragment(sv) ? row[k] : sv;
              }
              const idx = store.findIndex((r) => keyOf(r) === keyOf(row));
              if (idx >= 0) store[idx] = { ...store[idx], ...resolved };
              else store.push(resolved);
            }
            return Promise.resolve();
          },
        };
      },
    }),
  }),
}));

type FakeQuery<T> = Promise<T[]> & { where: () => FakeQuery<T>; orderBy: (dir?: unknown) => FakeQuery<T>; limit: (n: number) => FakeQuery<T>; groupBy: (...cols: unknown[]) => FakeQuery<T> };

// drizzle's desc(col)/asc(col) both compile to a `sql` tagged-template
// fragment (see drizzle-orm/sql/expressions/select.js: `sql`${column} desc``)
// — its queryChunks array ends with a StringChunk whose `.value` is
// [" desc"], so walking those chunks (not JSON.stringify, which throws on
// the circular table reference the middle chunk carries) reliably tells
// the two apart without depending on drizzle's internal class shapes.
function isDescOrder(dir: unknown): boolean {
  const chunks = (dir as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks.some((c) => {
    const value = (c as { value?: unknown[] })?.value;
    return Array.isArray(value) && value.some((v) => typeof v === "string" && v.includes("desc"));
  });
}

function makeQuery<T>(data: T[]): FakeQuery<T> {
  const promise = Promise.resolve(data) as FakeQuery<T>;
  promise.where = () => makeQuery(data);
  // getLatestStoredCandles relies on real Postgres's ORDER BY date ASC/DESC
  // to put the latest-dated candle first or last, regardless of insertion/
  // provider order — sort here (by a `date` field, when rows have one) so
  // this fake actually exercises that "greatest date wins" property, in
  // whichever direction the real query asked for, instead of just echoing
  // insertion order or hardcoding one direction.
  promise.orderBy = (dir?: unknown) => {
    const descending = isDescOrder(dir);
    return makeQuery(
      [...data].sort((a, b) => {
        const da = (a as { date?: Date }).date;
        const db = (b as { date?: Date }).date;
        if (!(da instanceof Date) || !(db instanceof Date)) return 0;
        return descending ? db.getTime() - da.getTime() : da.getTime() - db.getTime();
      })
    );
  };
  promise.limit = (n: number) => makeQuery(data.slice(0, n));
  // getEconomicEventCoverage/getEconomicIndicatorCoverage's .select({...
  // sql`max(...)` ...}).groupBy(...) is not actually executed by this fake
  // (no real SQL engine) — test fixtures must already be shaped exactly
  // like the query's post-aggregation projection; groupBy is a no-op here,
  // same convention as where() above.
  promise.groupBy = () => makeQuery(data);
  return promise;
}

import { getLatestEconomicEventsByIndicators, getEconomicEventCoverage, getEconomicIndicatorCoverage, upsertCandles, getLatestStoredCandles } from "./market-data";
import { NormalizedCandle } from "@/services/types";

describe("getLatestEconomicEventsByIndicators", () => {
  it("returns an empty map when no event has been released for any requested pair (never a fabricated stub row)", async () => {
    selectResults = { economic_events: [] };
    const result = await getLatestEconomicEventsByIndicators(["US"], ["gdp"]);
    expect(result.size).toBe(0);
  });

  it("returns an empty map immediately (no query) when either input array is empty", async () => {
    selectResults = { economic_events: [{ event: "GDP", dateTime: new Date(), country: "US", indicatorKey: "gdp", actual: 2.1, previous: 1.9, forecast: 2.0, revisedPrevious: null, importanceTier: "HIGH" }] };
    expect((await getLatestEconomicEventsByIndicators([], ["gdp"])).size).toBe(0);
    expect((await getLatestEconomicEventsByIndicators(["US"], [])).size).toBe(0);
  });

  it("returns the real stored row for each pair, keyed by country:indicatorKey", async () => {
    selectResults = {
      economic_events: [
        { event: "GDP Growth Rate QoQ", dateTime: new Date("2027-01-30T13:30:00.000Z"), country: "US", indicatorKey: "gdp", actual: 2.1, previous: 1.9, forecast: 2.0, revisedPrevious: null, importanceTier: "HIGH" },
        { event: "CPI YoY", dateTime: new Date("2027-01-14T13:30:00.000Z"), country: "US", indicatorKey: "cpi", actual: 3.1, previous: 3.2, forecast: 3.0, revisedPrevious: null, importanceTier: "HIGH" },
      ],
    };
    const result = await getLatestEconomicEventsByIndicators(["US"], ["gdp", "cpi"]);
    expect(result.get("US:gdp")).toEqual({ event: "GDP Growth Rate QoQ", dateTime: "2027-01-30T13:30:00.000Z", actual: 2.1, previous: 1.9, forecast: 2.0, revisedPrevious: null, importanceTier: "HIGH" });
    expect(result.get("US:cpi")).toEqual({ event: "CPI YoY", dateTime: "2027-01-14T13:30:00.000Z", actual: 3.1, previous: 3.2, forecast: 3.0, revisedPrevious: null, importanceTier: "HIGH" });
  });

  it("keeps only the latest release per (country, indicatorKey) pair when multiple are stored", async () => {
    selectResults = {
      economic_events: [
        { event: "GDP Growth Rate QoQ (Q4)", dateTime: new Date("2027-01-30T13:30:00.000Z"), country: "US", indicatorKey: "gdp", actual: 2.1, previous: 1.9, forecast: 2.0, revisedPrevious: null, importanceTier: "HIGH" },
        { event: "GDP Growth Rate QoQ (Q3)", dateTime: new Date("2026-10-30T13:30:00.000Z"), country: "US", indicatorKey: "gdp", actual: 1.9, previous: 1.7, forecast: 1.8, revisedPrevious: null, importanceTier: "HIGH" },
      ],
    };
    const result = await getLatestEconomicEventsByIndicators(["US"], ["gdp"]);
    expect(result.size).toBe(1);
    expect(result.get("US:gdp")?.event).toBe("GDP Growth Rate QoQ (Q4)");
  });

  it("distinguishes the same indicatorKey across different countries", async () => {
    selectResults = {
      economic_events: [
        { event: "Fed Funds Rate", dateTime: new Date("2027-01-29T19:00:00.000Z"), country: "US", indicatorKey: "fedRateDecision", actual: 4.5, previous: 4.5, forecast: 4.5, revisedPrevious: null, importanceTier: "HIGH" },
        { event: "BoE Rate Decision", dateTime: new Date("2027-01-30T12:00:00.000Z"), country: "GB", indicatorKey: "boeRateDecision", actual: 4.0, previous: 4.25, forecast: 4.0, revisedPrevious: null, importanceTier: "HIGH" },
      ],
    };
    const result = await getLatestEconomicEventsByIndicators(["US", "GB"], ["fedRateDecision", "boeRateDecision"]);
    expect(result.get("US:fedRateDecision")?.actual).toBe(4.5);
    expect(result.get("GB:boeRateDecision")?.actual).toBe(4.0);
  });

  it("skips a row (never a real number) when actual is somehow null, even though the query filters for isNotNull(actual)", async () => {
    selectResults = {
      economic_events: [{ event: "CPI", dateTime: new Date("2027-01-01T00:00:00.000Z"), country: "US", indicatorKey: "cpi", actual: null, previous: 3.1, forecast: 3.2, revisedPrevious: null, importanceTier: "HIGH" }],
    };
    const result = await getLatestEconomicEventsByIndicators(["US"], ["cpi"]);
    expect(result.size).toBe(0);
  });
});

describe("getEconomicEventCoverage", () => {
  it("returns one row per (country, indicatorKey) pair with a classified, released event", async () => {
    selectResults = {
      economic_events: [
        { country: "US", indicatorKey: "cpi", latestDate: "2026-09-15T13:30:00.000Z" },
        { country: "GB", indicatorKey: "boeRateDecision", latestDate: "2027-01-30T12:00:00.000Z" },
      ],
    };
    const result = await getEconomicEventCoverage();
    expect(result).toEqual([
      { country: "US", indicatorKey: "cpi", latestDate: "2026-09-15T13:30:00.000Z" },
      { country: "GB", indicatorKey: "boeRateDecision", latestDate: "2027-01-30T12:00:00.000Z" },
    ]);
  });

  it("returns an empty array when nothing has ever been classified (never a fabricated row)", async () => {
    selectResults = { economic_events: [] };
    expect(await getEconomicEventCoverage()).toEqual([]);
  });
});

describe("getEconomicIndicatorCoverage", () => {
  it("returns one row per (country, indicator) pair with at least one stored FRED observation", async () => {
    selectResults = {
      economic_indicators: [
        { country: "US", indicator: "gdpGrowth", latestDate: "2026-04-01T00:00:00.000Z" },
        { country: "JP", indicator: "cpi", latestDate: "2021-06-01T00:00:00.000Z" },
      ],
    };
    const result = await getEconomicIndicatorCoverage();
    expect(result).toEqual([
      { country: "US", indicator: "gdpGrowth", latestDate: "2026-04-01T00:00:00.000Z" },
      { country: "JP", indicator: "cpi", latestDate: "2021-06-01T00:00:00.000Z" },
    ]);
  });

  it("returns an empty array when no FRED series has ever been fetched (never a fabricated row)", async () => {
    selectResults = { economic_indicators: [] };
    expect(await getEconomicIndicatorCoverage()).toEqual([]);
  });
});

// Phase 2 regression coverage: the GBPJPY "stale FMP chart" bug traced back
// to two storage-layer defects — (1) upsertCandles' onConflictDoUpdate never
// wrote the `provider` column, so a bar first stored during an OANDA outage
// (as FMP) stayed permanently mislabeled even once OANDA re-wrote the same
// date with corrected values, and (2) getLatestStoredCandles must genuinely
// pick the candle with the greatest `date` across BOTH providers' rows, not
// whichever provider happened to write most recently in wall-clock time —
// see oanda-market-data.ts's alignmentTimezone=UTC fix for why the two
// providers' `date` values are now directly comparable in the first place.
function candle(date: string, close: number): NormalizedCandle {
  return { date, open: close, high: close, low: close, close, volume: 1000 };
}

describe("upsertCandles", () => {
  beforeEach(() => {
    selectResults = {};
  });

  it("a later write for the same (symbol, timeframe, date) overwrites OHLC AND provider — never leaves a stale provider label behind", async () => {
    await upsertCandles("GBPJPY", "1d", [candle("2026-08-20T00:00:00.000Z", 185.0)], "fmp");
    await upsertCandles("GBPJPY", "1d", [candle("2026-08-20T00:00:00.000Z", 185.4)], "oanda");

    const stored = await getLatestStoredCandles("GBPJPY", "1d");
    expect(stored!.candles).toHaveLength(1);
    expect(stored!.candles[0].close).toBe(185.4);
    expect(stored!.provider).toBe("oanda");
  });

  it("never accumulates a duplicate row for the same (symbol, timeframe, date) key", async () => {
    await upsertCandles("GBPJPY", "1d", [candle("2026-08-20T00:00:00.000Z", 185.0)], "fmp");
    await upsertCandles("GBPJPY", "1d", [candle("2026-08-20T00:00:00.000Z", 185.4)], "oanda");

    expect((selectResults.market_candles ?? []).length).toBe(1);
  });
});

describe("getLatestStoredCandles — freshest DATE wins across mixed providers, never whichever provider wrote most recently", () => {
  beforeEach(() => {
    selectResults = {};
  });

  it("surfaces a genuinely newer OANDA candle over an older FMP fallback row, even though the FMP row was written to storage later in wall-clock time", async () => {
    // FMP wrote this older trading day's bar (e.g. during a past OANDA
    // outage) AFTER OANDA had already written the newer day below — provider
    // choice must be driven by the candle's own `date`, never fetchedAt/
    // insertion order.
    await upsertCandles("GBPJPY", "1d", [candle("2026-08-21T00:00:00.000Z", 185.4)], "oanda");
    await upsertCandles("GBPJPY", "1d", [candle("2026-08-19T00:00:00.000Z", 184.9)], "fmp");

    const stored = await getLatestStoredCandles("GBPJPY", "1d");
    expect(stored!.provider).toBe("oanda");
    expect(stored!.candles[stored!.candles.length - 1].date).toBe("2026-08-21T00:00:00.000Z");
  });

  it("returns null when no candles have ever been stored for this symbol/timeframe", async () => {
    const stored = await getLatestStoredCandles("GBPJPY", "1d");
    expect(stored).toBeNull();
  });
});
