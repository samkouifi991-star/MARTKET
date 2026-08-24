import { describe, expect, it, vi, beforeEach } from "vitest";

// Mirrors this repo's established db-query test pattern (see
// market-data.test.ts / current-score.test.ts): the test directly
// controls what select().where() returns for a given case rather than
// re-implementing Postgres's own WHERE filtering in the fake — real
// filtering (identifier/action/window) is drizzle-orm's and Postgres's
// job, already expressed via and(eq(...), eq(...), gt(...)) in
// rate-limit.ts itself. What THIS test verifies is recordAuthAttempt's
// own contract: it inserts with the right values, prunes old rows, and
// returns exactly what the (test-controlled) filtered read contains.
let selectResult: unknown[] = [];
const insertCalls: { identifier: string; action: string }[] = [];
let deleteCalled = false;

type FakeQuery<T> = Promise<T[]> & { where: () => FakeQuery<T> };
function makeQuery<T>(data: T[]): FakeQuery<T> {
  const promise = Promise.resolve(data) as FakeQuery<T>;
  promise.where = () => makeQuery(data);
  return promise;
}

vi.mock("../client", () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: { identifier: string; action: string }) => {
        insertCalls.push(v);
        return Promise.resolve();
      },
    }),
    delete: () => ({
      where: () => {
        deleteCalled = true;
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => makeQuery(selectResult),
    }),
  }),
}));

import { recordAuthAttempt } from "./rate-limit";

describe("recordAuthAttempt", () => {
  beforeEach(() => {
    selectResult = [];
    insertCalls.length = 0;
    deleteCalled = false;
  });

  it("inserts an attempt row with the real identifier and action", async () => {
    selectResult = [{}];
    await recordAuthAttempt("1.2.3.4", "signin", 60_000);
    expect(insertCalls).toEqual([{ identifier: "1.2.3.4", action: "signin" }]);
  });

  it("keeps signin and signup as distinct actions on the same insert call", async () => {
    selectResult = [{}];
    await recordAuthAttempt("1.2.3.4", "signup", 3_600_000);
    expect(insertCalls[0].action).toBe("signup");
  });

  it("returns the count of the (window-filtered) read — including the attempt just recorded", async () => {
    selectResult = [{}, {}, {}];
    const count = await recordAuthAttempt("1.2.3.4", "signin", 60_000);
    expect(count).toBe(3);
  });

  it("returns 0 when the filtered read finds nothing (defensive — should never happen since the row was just inserted)", async () => {
    selectResult = [];
    const count = await recordAuthAttempt("1.2.3.4", "signin", 60_000);
    expect(count).toBe(0);
  });

  it("prunes old rows on every write, keeping the table bounded without a separate cleanup job", async () => {
    selectResult = [{}];
    await recordAuthAttempt("1.2.3.4", "signin", 60_000);
    expect(deleteCalled).toBe(true);
  });
});
