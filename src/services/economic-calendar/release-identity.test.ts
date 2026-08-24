import { describe, expect, it } from "vitest";
import { releaseKeyFor } from "./release-identity";

describe("releaseKeyFor", () => {
  it("builds a stable, order-independent key from provider+country+indicator+timestamp", () => {
    expect(releaseKeyFor("fmp", "US", "cpi", "2027-01-01T13:30:00.000Z")).toBe("fmp:US:cpi:2027-01-01T13:30:00.000Z");
  });

  it("produces the same key for the same real release regardless of anything response-order-dependent", () => {
    // Two "fetches" of the identical real release, as if the provider's raw
    // array index shifted between calls — releaseKeyFor never sees or uses
    // that index, so the key is identical either way.
    const a = releaseKeyFor("fmp", "GB", "nfp", "2027-02-05T08:30:00.000Z");
    const b = releaseKeyFor("fmp", "GB", "nfp", "2027-02-05T08:30:00.000Z");
    expect(a).toBe(b);
  });

  it("differs when any real component of the release differs", () => {
    const base = releaseKeyFor("fmp", "US", "cpi", "2027-01-01T13:30:00.000Z");
    expect(releaseKeyFor("fmp", "GB", "cpi", "2027-01-01T13:30:00.000Z")).not.toBe(base);
    expect(releaseKeyFor("fmp", "US", "coreCpi", "2027-01-01T13:30:00.000Z")).not.toBe(base);
    expect(releaseKeyFor("fmp", "US", "cpi", "2027-02-01T13:30:00.000Z")).not.toBe(base);
    expect(releaseKeyFor("trading-economics", "US", "cpi", "2027-01-01T13:30:00.000Z")).not.toBe(base);
  });
});
