import { describe, expect, it, vi } from "vitest";
import { getTableName, Table } from "drizzle-orm";

let selectResults: Record<string, unknown[]> = {};

// Mirrors this repo's established db-query test pattern (see
// release-tracking.test.ts) — a fake chainable select keyed by table name.
vi.mock("../client", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: Table) => makeQuery(selectResults[getTableName(table)] ?? []),
    }),
  }),
}));

type FakeQuery<T> = Promise<T[]> & { where: () => FakeQuery<T>; orderBy: () => FakeQuery<T>; limit: (n: number) => FakeQuery<T> };
function makeQuery<T>(data: T[]): FakeQuery<T> {
  const promise = Promise.resolve(data) as FakeQuery<T>;
  promise.where = () => makeQuery(data);
  promise.orderBy = () => makeQuery(data);
  promise.limit = (n: number) => makeQuery(data.slice(0, n));
  return promise;
}

import { getLatestEconomicEventByIndicator } from "./market-data";

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
