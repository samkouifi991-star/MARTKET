import { describe, expect, it, vi, beforeEach } from "vitest";
import { getTableName, Table } from "drizzle-orm";

const insertedValues: { table: string; values: unknown }[] = [];
const updatedValues: { table: string; values: unknown }[] = [];
let selectResults: Record<string, unknown[]> = {};
let nextId = 1;

// Mirrors this repo's established db-query test pattern (see
// scoring-v2.test.ts / economic-releases.test.ts): a table-keyed insert/
// update capture plus a fake chainable select, using drizzle-orm's own
// getTableName so the mock always routes to the right fake table.
vi.mock("../client", () => ({
  getDb: () => ({
    insert: (table: Table) => ({
      values: (v: unknown) => {
        const row = { id: nextId++, ...(v as Record<string, unknown>) };
        insertedValues.push({ table: getTableName(table), values: row });
        return { returning: () => Promise.resolve([row]) };
      },
    }),
    update: (table: Table) => ({
      set: (v: unknown) => ({
        where: () => {
          updatedValues.push({ table: getTableName(table), values: v });
          const merged = { id: 1, ...(selectResults[getTableName(table)]?.[0] as Record<string, unknown>), ...(v as Record<string, unknown>) };
          return { returning: () => Promise.resolve([merged]) };
        },
      }),
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

import { getLatencySamples, getRecentReleaseTracking, getReleaseTrackingByKey, markReleaseProcessed, upsertReleaseTracking } from "./release-tracking";

const BASE_INPUT = {
  releaseKey: "fmp:US:cpi:2027-01-01T13:30:00.000Z",
  provider: "fmp",
  country: "US",
  indicatorKey: "cpi" as const,
  rawEvent: "CPI m/m",
  importanceTier: "HIGH" as const,
  scheduledAt: "2027-01-01T13:30:00.000Z",
  forecast: 0.2,
  previous: 0.2,
  actual: null as number | null,
  revisedPrevious: null as number | null,
};

describe("upsertReleaseTracking", () => {
  beforeEach(() => {
    insertedValues.length = 0;
    updatedValues.length = 0;
    selectResults = {};
    nextId = 1;
  });

  it("creates a new row in 'scheduled' state when actual isn't out yet", async () => {
    const { row, transition } = await upsertReleaseTracking(BASE_INPUT);
    expect(transition).toBe("created_scheduled");
    expect(row.state).toBe("scheduled");
    expect(row.firstDetectedAt).toBeNull();
  });

  it("creates a new row directly in 'released' state (with firstDetectedAt stamped) when actual is already available on first sight", async () => {
    const { row, transition } = await upsertReleaseTracking({ ...BASE_INPUT, actual: 0.3 });
    expect(transition).toBe("created_released");
    expect(row.state).toBe("released");
    expect(row.firstDetectedAt).not.toBeNull();
  });

  it("transitions scheduled -> released the first time actual appears on an existing row", async () => {
    selectResults["economic_release_tracking"] = [{ ...BASE_INPUT, id: 1, state: "scheduled", firstDetectedAt: null, affectedMarkets: [], scheduledAt: new Date(BASE_INPUT.scheduledAt) }];
    const { row, transition } = await upsertReleaseTracking({ ...BASE_INPUT, actual: 0.3 });
    expect(transition).toBe("became_released");
    expect(row.state).toBe("released");
  });

  it("is a no-op transition when polled again with no new information", async () => {
    selectResults["economic_release_tracking"] = [{ ...BASE_INPUT, id: 1, state: "released", actual: 0.3, firstDetectedAt: new Date(), affectedMarkets: [], scheduledAt: new Date(BASE_INPUT.scheduledAt) }];
    const { transition } = await upsertReleaseTracking({ ...BASE_INPUT, actual: 0.3 });
    expect(transition).toBe("unchanged");
  });

  it("marks an already-processed release 'revised' when a later poll finds a different actual — without ever regressing state", async () => {
    selectResults["economic_release_tracking"] = [{ ...BASE_INPUT, id: 1, state: "processed", actual: 0.3, firstDetectedAt: new Date(), processedAt: new Date(), affectedMarkets: ["XAUUSD"], scheduledAt: new Date(BASE_INPUT.scheduledAt) }];
    const { row, transition } = await upsertReleaseTracking({ ...BASE_INPUT, actual: 0.4 });
    expect(transition).toBe("became_revised");
    expect(row.state).toBe("revised");
    expect(row.actual).toBe(0.4);
  });

  it("does not mark 'revised' when the actual is unchanged from what's already processed", async () => {
    selectResults["economic_release_tracking"] = [{ ...BASE_INPUT, id: 1, state: "processed", actual: 0.3, firstDetectedAt: new Date(), processedAt: new Date(), affectedMarkets: ["XAUUSD"], scheduledAt: new Date(BASE_INPUT.scheduledAt) }];
    const { transition } = await upsertReleaseTracking({ ...BASE_INPUT, actual: 0.3 });
    expect(transition).toBe("unchanged");
  });
});

describe("markReleaseProcessed", () => {
  beforeEach(() => {
    updatedValues.length = 0;
  });

  it("sets state to processed with the surprise id and affected markets", async () => {
    await markReleaseProcessed("fmp:US:cpi:2027-01-01T13:30:00.000Z", { surpriseId: 42, affectedMarkets: ["XAUUSD", "SPX500"] });
    const write = updatedValues.find((w) => w.table === "economic_release_tracking");
    expect(write?.values).toMatchObject({ state: "processed", surpriseId: 42, affectedMarkets: ["XAUUSD", "SPX500"] });
  });
});

describe("getReleaseTrackingByKey / getRecentReleaseTracking / getLatencySamples", () => {
  beforeEach(() => {
    selectResults = {};
  });

  it("getReleaseTrackingByKey returns null when nothing is stored yet", async () => {
    selectResults["economic_release_tracking"] = [];
    expect(await getReleaseTrackingByKey("fmp:US:cpi:2027-01-01T13:30:00.000Z")).toBeNull();
  });

  it("getRecentReleaseTracking maps real stored rows", async () => {
    selectResults["economic_release_tracking"] = [{ ...BASE_INPUT, id: 1, state: "scheduled", firstDetectedAt: null, processedAt: null, lastRevisedAt: null, surpriseId: null, affectedMarkets: [], scheduledAt: new Date(BASE_INPUT.scheduledAt) }];
    const rows = await getRecentReleaseTracking();
    expect(rows).toHaveLength(1);
    expect(rows[0].releaseKey).toBe(BASE_INPUT.releaseKey);
  });

  it("getLatencySamples excludes rows with no real firstDetectedAt yet", async () => {
    selectResults["economic_release_tracking"] = [
      { ...BASE_INPUT, id: 1, firstDetectedAt: new Date("2027-01-01T13:35:00.000Z"), scheduledAt: new Date(BASE_INPUT.scheduledAt) },
      { ...BASE_INPUT, id: 2, releaseKey: "fmp:US:nfp:2027-01-01T13:30:00.000Z", firstDetectedAt: null, scheduledAt: new Date(BASE_INPUT.scheduledAt) },
    ];
    const samples = await getLatencySamples();
    expect(samples).toHaveLength(1);
    expect(samples[0].firstDetectedAt).toBe("2027-01-01T13:35:00.000Z");
  });
});
