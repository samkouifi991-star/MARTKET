import { describe, expect, it } from "vitest";
import { dedupeScoreHistoryByDate, MIN_LEGITIMATE_OBSERVATIONS } from "./score-history-view";

describe("dedupeScoreHistoryByDate", () => {
  it("collapses repeated same-day observations down to the single latest one", () => {
    const history = [
      { date: "2026-08-20T09:00:00.000Z", score: 1.0 },
      { date: "2026-08-20T15:00:00.000Z", score: 1.4 },
      { date: "2026-08-20T21:00:00.000Z", score: 1.7 },
    ];
    const result = dedupeScoreHistoryByDate(history);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(1.7);
    expect(result[0].date).toBe("2026-08-20T21:00:00.000Z");
  });

  it("keeps one point per distinct calendar date, sorted ascending", () => {
    const history = [
      { date: "2026-08-22T00:00:00.000Z", score: 3 },
      { date: "2026-08-20T00:00:00.000Z", score: 1 },
      { date: "2026-08-21T00:00:00.000Z", score: 2 },
    ];
    const result = dedupeScoreHistoryByDate(history);
    expect(result.map((p) => p.date)).toEqual(["2026-08-20T00:00:00.000Z", "2026-08-21T00:00:00.000Z", "2026-08-22T00:00:00.000Z"]);
  });

  it("is idempotent — deduping an already-deduped series changes nothing", () => {
    const history = [
      { date: "2026-08-20T00:00:00.000Z", score: 1 },
      { date: "2026-08-21T00:00:00.000Z", score: 2 },
    ];
    expect(dedupeScoreHistoryByDate(dedupeScoreHistoryByDate(history))).toEqual(dedupeScoreHistoryByDate(history));
  });

  it("returns an empty array for empty input, never fabricating a point", () => {
    expect(dedupeScoreHistoryByDate([])).toEqual([]);
  });

  it("leaves a series with no same-day duplicates untouched (order and values)", () => {
    const history = [
      { date: "2026-08-20T00:00:00.000Z", score: 1 },
      { date: "2026-08-21T00:00:00.000Z", score: -0.5 },
      { date: "2026-08-22T00:00:00.000Z", score: 2.3 },
    ];
    expect(dedupeScoreHistoryByDate(history)).toEqual(history);
  });
});

describe("MIN_LEGITIMATE_OBSERVATIONS", () => {
  it("matches the spec's '~7 legitimate observations' floor", () => {
    expect(MIN_LEGITIMATE_OBSERVATIONS).toBe(7);
  });
});
