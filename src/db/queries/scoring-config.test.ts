// Round-trip test for the scoring_configurations table — the persisted
// single source of truth for Admin's factor weights and bias thresholds
// (see schema.ts). Proves: (1) a normal finite-number configuration
// (including "Very Bearish", now a real editable threshold rather than a
// -Infinity floor) round-trips exactly; (2) a configuration saved under
// the old -Infinity-floor convention still survives the jsonb boundary via
// the string marker, since JSON.stringify would otherwise silently coerce
// it to null; (3) saving a new configuration deactivates every previous
// one, so exactly one row is ever active.
import { describe, expect, it, beforeEach, vi } from "vitest";

let rows: Record<string, unknown>[] = [];
let nextId = 1;

type FakeQuery<T> = Promise<T[]> & { where: () => FakeQuery<T>; orderBy: () => FakeQuery<T>; limit: (n: number) => FakeQuery<T> };
function makeQuery<T extends Record<string, unknown>>(data: T[]): FakeQuery<T> {
  const promise = Promise.resolve(data) as FakeQuery<T>;
  // This module's only select query filters on `active` (see
  // getActiveScoringConfiguration) — a real drizzle `where(eq(...))`
  // condition object isn't interpreted generically here, so this fake
  // narrowly special-cases the one predicate this file's queries use.
  promise.where = () => makeQuery(data.filter((r) => r.active === true));
  promise.orderBy = () => makeQuery([...data].sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()));
  promise.limit = (n: number) => makeQuery(data.slice(0, n));
  return promise;
}

vi.mock("../client", () => ({
  getDb: () => ({
    select: () => ({ from: () => makeQuery(rows as Record<string, unknown>[]) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          for (const r of rows) Object.assign(r, values);
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          const row = { id: nextId++, createdAt: new Date(), ...v };
          rows.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
  }),
}));

import { createScoringConfiguration, getActiveScoringConfiguration } from "./scoring-config";
import { DEFAULT_FACTOR_WEIGHTS, DEFAULT_BIAS_THRESHOLDS, BiasThreshold } from "@/lib/config";

describe("scoring_configurations round trip", () => {
  beforeEach(() => {
    rows = [];
    nextId = 1;
  });

  it("round-trips weights and bias thresholds, including a finite Very Bearish threshold", async () => {
    await createScoringConfiguration({ weights: DEFAULT_FACTOR_WEIGHTS, biasThresholds: DEFAULT_BIAS_THRESHOLDS, createdBy: "admin@test.com" });
    const active = await getActiveScoringConfiguration();

    expect(active).not.toBeNull();
    expect(active!.weights).toEqual(DEFAULT_FACTOR_WEIGHTS);
    expect(active!.createdBy).toBe("admin@test.com");
    const veryBearish = active!.biasThresholds.find((t) => t.bias === "Very Bearish")!;
    expect(veryBearish.min).toBe(-10);
    expect(active!.biasThresholds).toEqual(DEFAULT_BIAS_THRESHOLDS);
  });

  it("still deserializes a legacy configuration saved with the old -Infinity Very Bearish floor", async () => {
    const legacyThresholds: BiasThreshold[] = [
      { bias: "Very Bullish", min: 8 },
      { bias: "Bullish", min: 4 },
      { bias: "Neutral", min: -3.9 },
      { bias: "Bearish", min: -7.9 },
      { bias: "Very Bearish", min: -Infinity },
    ];
    await createScoringConfiguration({ weights: DEFAULT_FACTOR_WEIGHTS, biasThresholds: legacyThresholds, createdBy: "admin@test.com" });
    const active = await getActiveScoringConfiguration();

    const veryBearish = active!.biasThresholds.find((t) => t.bias === "Very Bearish")!;
    expect(veryBearish.min).toBe(-Infinity);
  });

  it("deactivates every prior version when a new one is saved — only one active at a time", async () => {
    const v1 = await createScoringConfiguration({ weights: DEFAULT_FACTOR_WEIGHTS, biasThresholds: DEFAULT_BIAS_THRESHOLDS, createdBy: "admin@test.com" });
    const v2 = await createScoringConfiguration({
      weights: { ...DEFAULT_FACTOR_WEIGHTS, technical: 0.3, institutional: 0.05 },
      biasThresholds: DEFAULT_BIAS_THRESHOLDS,
      createdBy: "admin@test.com",
    });

    expect(rows.filter((r) => r.active === true).length).toBe(1);
    const active = await getActiveScoringConfiguration();
    expect(active!.id).toBe(v2.id);
    expect(active!.id).not.toBe(v1.id);
    expect(active!.weights.technical).toBe(0.3);
  });

  it("returns null when no configuration has ever been saved", async () => {
    const active = await getActiveScoringConfiguration();
    expect(active).toBeNull();
  });
});
