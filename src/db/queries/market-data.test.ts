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

type FakeQuery<T> = Promise<T[]> & { where: () => FakeQuery<T>; orderBy: (dir?: unknown) => FakeQuery<T>; limit: (n: number) => FakeQuery<T> };

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
  return promise;
}

import { getLatestEconomicEventByIndicator, upsertCandles, getLatestStoredCandles } from "./market-data";
import { NormalizedCandle } from "@/services/types";

describe("getLatestEconomicEventByIndicator", () => {
  it("returns null when no event has been released for this country/indicatorKey (never a fabricated stub row)", async () => {
    selectResults = { economic_events: [] };
    const result = await getLatestEconomicEventByIndicator("US", "gdp");
    expect(result).toBeNull();
  });

  it("returns the real stored row, mapped to StoredEconomicEventRow shape", async () => {
    selectResults = {
      economic_events: [
        {
          event: "GDP Growth Rate QoQ",
          dateTime: new Date("2027-01-30T13:30:00.000Z"),
          actual: 2.1,
          previous: 1.9,
          forecast: 2.0,
          importanceTier: "HIGH",
        },
      ],
    };
    const result = await getLatestEconomicEventByIndicator("US", "gdp");
    expect(result).toEqual({
      event: "GDP Growth Rate QoQ",
      dateTime: "2027-01-30T13:30:00.000Z",
      actual: 2.1,
      previous: 1.9,
      forecast: 2.0,
      importanceTier: "HIGH",
    });
  });

  it("returns null (never a real number) when actual is somehow null on the returned row, even though the query filters for isNotNull(actual)", async () => {
    selectResults = {
      economic_events: [{ event: "CPI", dateTime: new Date("2027-01-01T00:00:00.000Z"), actual: null, previous: 3.1, forecast: 3.2, importanceTier: "HIGH" }],
    };
    const result = await getLatestEconomicEventByIndicator("US", "cpi");
    expect(result).toBeNull();
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
