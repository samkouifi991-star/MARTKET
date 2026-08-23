import { describe, expect, it, vi, beforeEach } from "vitest";
import { getTableName, Table } from "drizzle-orm";

const insertedValues: { table: string; values: unknown }[] = [];
let selectResults: Record<string, unknown[]> = {};
let nextId = 1;

vi.mock("../client", () => ({
  getDb: () => ({
    insert: (table: Table) => ({
      values: (v: unknown) => {
        const row = { id: nextId++, ...(v as Record<string, unknown>) };
        insertedValues.push({ table: getTableName(table), values: row });
        return { returning: () => Promise.resolve([row]) };
      },
    }),
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

import { getHistoricalEffectiveSurprises, getRecentEventShocks, recordEventShock, recordReleaseSurprise } from "./economic-releases";

describe("recordReleaseSurprise", () => {
  beforeEach(() => {
    insertedValues.length = 0;
    nextId = 1;
  });

  it("writes a full release-surprise row and returns its new id", async () => {
    const id = await recordReleaseSurprise({
      indicatorKey: "cpi",
      country: "US",
      releaseDateTime: new Date().toISOString(),
      actual: 0.3,
      forecast: 0.2,
      previous: 0.2,
      revisedPrevious: null,
      surprise: 0.1,
      surpriseZ: 1.2,
      effectiveSurprise: 0.1,
      importanceTier: "HIGH",
      eventExternalId: "fmp-US-CPI-1",
    });
    expect(id).toBe(1);
    const write = insertedValues.find((w) => w.table === "economic_release_surprises");
    expect(write?.values).toMatchObject({ indicatorKey: "cpi", country: "US", surpriseZ: 1.2, importanceTier: "HIGH" });
  });
});

describe("getHistoricalEffectiveSurprises", () => {
  beforeEach(() => {
    selectResults = {};
  });

  it("returns real historical effectiveSurprise values for the indicator+country, excluding the just-recorded row", async () => {
    selectResults["economic_release_surprises"] = [
      { id: 3, indicatorKey: "cpi", country: "US", effectiveSurprise: 0.1 },
      { id: 2, indicatorKey: "cpi", country: "US", effectiveSurprise: -0.05 },
      { id: 1, indicatorKey: "cpi", country: "US", effectiveSurprise: 0.2 },
    ];
    const history = await getHistoricalEffectiveSurprises("cpi", "US", 40, 3);
    expect(history).toEqual([-0.05, 0.2]);
  });

  it("excludes rows with no effectiveSurprise (e.g. no forecast was ever available for that release)", async () => {
    selectResults["economic_release_surprises"] = [
      { id: 2, indicatorKey: "cpi", country: "US", effectiveSurprise: null },
      { id: 1, indicatorKey: "cpi", country: "US", effectiveSurprise: 0.2 },
    ];
    const history = await getHistoricalEffectiveSurprises("cpi", "US");
    expect(history).toEqual([0.2]);
  });
});

describe("event shocks", () => {
  beforeEach(() => {
    insertedValues.length = 0;
    selectResults = {};
  });

  it("records an event shock", async () => {
    await recordEventShock({ symbol: "XAUUSD", factorKey: "inflation", sourceReleaseId: 5, initialContribution: 1.2, importanceTier: "HIGH" });
    const write = insertedValues.find((w) => w.table === "event_shocks");
    expect(write?.values).toMatchObject({ symbol: "XAUUSD", factorKey: "inflation", initialContribution: 1.2 });
  });

  it("reads back recent shocks for a symbol", async () => {
    selectResults["event_shocks"] = [{ symbol: "XAUUSD", factorKey: null, initialContribution: 1.5, importanceTier: "HIGH", occurredAt: new Date() }];
    const shocks = await getRecentEventShocks("XAUUSD");
    expect(shocks).toHaveLength(1);
    expect(shocks[0].initialContribution).toBe(1.5);
  });
});
