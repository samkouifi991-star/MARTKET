import { describe, expect, it } from "vitest";
import { buildPriceScoreOverlay } from "./price-score-overlay";
import { PricePoint, ScoreHistoryPoint } from "@/lib/types";

function scorePoints(n: number, startDay = 1): ScoreHistoryPoint[] {
  return Array.from({ length: n }, (_, i) => ({ date: `2026-08-${String(startDay + i).padStart(2, "0")}T12:00:00.000Z`, score: i }));
}

function pricePoints(days: string[]): PricePoint[] {
  return days.map((d, i) => ({ date: `${d}T00:00:00.000Z`, price: 100 + i }));
}

describe("buildPriceScoreOverlay", () => {
  it("returns 'building' below MIN_LEGITIMATE_OBSERVATIONS", () => {
    const result = buildPriceScoreOverlay(pricePoints(["2026-08-01", "2026-08-02"]), scorePoints(3));
    expect(result.status).toBe("building");
  });

  it("returns 'building' with zero score history", () => {
    const result = buildPriceScoreOverlay(pricePoints(["2026-08-01"]), []);
    expect(result.status).toBe("building");
    if (result.status === "building") expect(result.deduped).toEqual([]);
  });

  it("joins price and score by calendar day, never fabricating a missing value", () => {
    const price = pricePoints(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]);
    const score = scorePoints(7); // 2026-08-01..07
    const result = buildPriceScoreOverlay(price, score);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.points).toHaveLength(7);
    expect(result.points[0]).toEqual({ day: "2026-08-01", price: 100, score: 0 });
    expect(result.trimmedToScoreWindow).toBe(false);
  });

  it("never extends the chart earlier than genuine score tracking began", () => {
    // Price history goes back further than score history.
    const price = pricePoints(["2026-07-01", "2026-07-15", "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]);
    const score = scorePoints(7); // starts 2026-08-01
    const result = buildPriceScoreOverlay(price, score);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.points.some((p) => p.day < "2026-08-01")).toBe(false);
    expect(result.trimmedToScoreWindow).toBe(true);
    expect(result.earliestScoreDate).toBe(score[0].date);
  });

  it("leaves a null gap (not an interpolated value) for a day only one series has", () => {
    const price = pricePoints(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"]);
    // Score is missing 2026-08-05 (8 legitimate points total, clears the 7-point floor).
    const score = [...scorePoints(4, 1), ...scorePoints(4, 6)];
    const result = buildPriceScoreOverlay(price, score);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const gapDay = result.points.find((p) => p.day === "2026-08-05");
    expect(gapDay?.price).toBe(104);
    expect(gapDay?.score).toBeNull();
  });

  it("collapses same-day repeated score computations to the latest one (dedupe)", () => {
    const price = pricePoints(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]);
    const score: ScoreHistoryPoint[] = [
      ...scorePoints(7),
      { date: "2026-08-07T23:00:00.000Z", score: 999 }, // later same-day recompute
    ];
    const result = buildPriceScoreOverlay(price, score);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.points.find((p) => p.day === "2026-08-07")?.score).toBe(999);
  });
});
