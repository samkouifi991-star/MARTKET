import { describe, expect, it } from "vitest";
import { newsDedupKey } from "./dedup-key";

describe("newsDedupKey", () => {
  it("is stable for the same headline/source/minute", () => {
    const a = newsDedupKey("Fed signals rates may remain higher for longer", "ForexFactory", "2026-08-26T12:31:10Z");
    const b = newsDedupKey("Fed signals rates may remain higher for longer", "ForexFactory", "2026-08-26T12:31:55Z");
    expect(a).toBe(b);
  });

  it("is case/whitespace-insensitive on the headline", () => {
    const a = newsDedupKey("Fed Signals Rates", "ForexFactory", "2026-08-26T12:31:00Z");
    const b = newsDedupKey("fed   signals rates", "ForexFactory", "2026-08-26T12:31:00Z");
    expect(a).toBe(b);
  });

  it("differs across minutes", () => {
    const a = newsDedupKey("Same headline", "ForexFactory", "2026-08-26T12:31:00Z");
    const b = newsDedupKey("Same headline", "ForexFactory", "2026-08-26T12:32:00Z");
    expect(a).not.toBe(b);
  });

  it("differs across sources", () => {
    const a = newsDedupKey("Same headline", "ForexFactory", "2026-08-26T12:31:00Z");
    const b = newsDedupKey("Same headline", "OtherSource", "2026-08-26T12:31:00Z");
    expect(a).not.toBe(b);
  });
});
