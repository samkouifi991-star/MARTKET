import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { formatRelative, filterToRecentWindow, RECENT_CHART_WINDOW_DAYS } from "./time";

describe("formatRelative", () => {
  beforeEach(() => {
    // Anchor "now" to a fixed real instant so past/future offsets are exact
    // and don't depend on the frozen demo NOW constant in this module.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a timestamp seconds in the past as 'just now'", () => {
    expect(formatRelative(new Date(Date.now() - 10_000).toISOString())).toBe("just now");
  });

  it("renders minutes/hours/days ago correctly for genuinely past timestamps", () => {
    expect(formatRelative(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(formatRelative(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe("3h ago");
    expect(formatRelative(new Date(Date.now() - 2 * 86_400_000).toISOString())).toBe("2d ago");
  });

  it("never reports a genuinely-past timestamp as future, regardless of how a frozen internal anchor might drift", () => {
    // This is the exact bug this test guards against: formatRelative must
    // compare against the real clock (Date.now()), not a hardcoded anchor
    // from whenever the demo data was authored — a live timestamp fetched
    // "just now" in the real world must never render as "in Nd".
    const justFetched = new Date(Date.now() - 1000).toISOString();
    expect(formatRelative(justFetched)).not.toMatch(/^in /);
    expect(formatRelative(justFetched)).toBe("just now");
  });

  it("renders genuinely future timestamps as 'in Xm/h/d', never past-tense", () => {
    expect(formatRelative(new Date(Date.now() + 10 * 60_000).toISOString())).toBe("in 10m");
    expect(formatRelative(new Date(Date.now() + 5 * 3600_000).toISOString())).toBe("in 5h");
    expect(formatRelative(new Date(Date.now() + 3 * 86_400_000).toISOString())).toBe("in 3d");
  });

  it("handles ISO timestamps with an explicit non-UTC offset the same as their UTC-normalized equivalent", () => {
    // 2027-01-15T11:00:00+02:00 == 2027-01-15T09:00:00Z == 3h before the
    // fixed "now" above, regardless of the offset used to express it.
    expect(formatRelative("2027-01-15T11:00:00+02:00")).toBe("3h ago");
    expect(formatRelative("2027-01-15T09:00:00Z")).toBe("3h ago");
    expect(formatRelative("2027-01-15T09:00:00.000Z")).toBe("3h ago");
  });

  it("handles a UNIX-seconds epoch converted to ms before being passed in (the FMP timestamp pattern)", () => {
    const unixSeconds = Math.floor((Date.now() - 3600_000) / 1000);
    const iso = new Date(unixSeconds * 1000).toISOString();
    expect(formatRelative(iso)).toBe("1h ago");
  });
});

describe("filterToRecentWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to the shared ~5 month (150 day) window every chart on the platform uses", () => {
    expect(RECENT_CHART_WINDOW_DAYS).toBe(150);
  });

  it("excludes points older than the window and keeps points within it", () => {
    const points = [
      { date: new Date(Date.now() - 200 * 86_400_000).toISOString() }, // too old
      { date: new Date(Date.now() - 151 * 86_400_000).toISOString() }, // just outside
      { date: new Date(Date.now() - 149 * 86_400_000).toISOString() }, // just inside
      { date: new Date(Date.now() - 10 * 86_400_000).toISOString() }, // recent
      { date: new Date().toISOString() }, // now
    ];
    const result = filterToRecentWindow(points);
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.date)).toEqual([points[2].date, points[3].date, points[4].date]);
  });

  it("accepts a custom window size, independent of the default 150-day constant", () => {
    const points = [
      { date: new Date(Date.now() - 40 * 86_400_000).toISOString() },
      { date: new Date(Date.now() - 20 * 86_400_000).toISOString() },
    ];
    expect(filterToRecentWindow(points, 30)).toHaveLength(1);
  });

  it("returns an empty array unchanged when given no points", () => {
    expect(filterToRecentWindow([])).toEqual([]);
  });
});
