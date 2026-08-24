import { describe, expect, it, beforeEach } from "vitest";
import { cached, clearRequestCache } from "./request-cache";

beforeEach(() => clearRequestCache());

describe("cached", () => {
  it("coalesces concurrent requests for the same key into a single fetch", async () => {
    let calls = 0;
    const fetcher = () =>
      new Promise<number>((resolve) => {
        calls += 1;
        setTimeout(() => resolve(42), 10);
      });

    const [a, b, c] = await Promise.all([cached("k", 60_000, fetcher), cached("k", 60_000, fetcher), cached("k", 60_000, fetcher)]);

    expect(calls).toBe(1);
    expect([a, b, c]).toEqual([42, 42, 42]);
  });

  it("serves from cache within the TTL without calling the fetcher again", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls;
    };

    const first = await cached("k", 60_000, fetcher);
    const second = await cached("k", 60_000, fetcher);

    expect(first).toBe(1);
    expect(second).toBe(1); // cached, not a fresh call
    expect(calls).toBe(1);
  });

  it("re-fetches once the TTL has expired", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls;
    };

    const first = await cached("k", 10, fetcher);
    await new Promise((r) => setTimeout(r, 20));
    const second = await cached("k", 10, fetcher);

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(calls).toBe(2);
  });

  it("does not cache a rejected fetch — the next call retries", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return "ok";
    };

    await expect(cached("k", 60_000, fetcher)).rejects.toThrow("boom");
    const result = await cached("k", 60_000, fetcher);

    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("keeps different keys fully independent", async () => {
    const a = await cached("a", 60_000, async () => "A");
    const b = await cached("b", 60_000, async () => "B");
    expect(a).toBe("A");
    expect(b).toBe("B");
  });
});
