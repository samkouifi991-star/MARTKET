import { describe, expect, it } from "vitest";
import { selectSmoothingAlpha, smoothedScore } from "./smoothing";

describe("smoothedScore", () => {
  it("returns the raw score unchanged on the first computation (no prior smoothed value)", () => {
    expect(smoothedScore(6, null, 0.5)).toBe(6);
  });

  it("blends new and previous scores by alpha", () => {
    // alpha=0.5: halfway between previous (6) and new (1)
    expect(smoothedScore(1, 6, 0.5)).toBe(3.5);
  });

  it("dampens the classic +6 -> +1 -> +6 noisy-swing scenario at a moderate alpha", () => {
    let smoothed: number | null = 6;
    smoothed = smoothedScore(1, smoothed, 0.3); // noisy dip
    expect(smoothed).toBeCloseTo(4.5, 4); // pulled toward but not all the way to 1
    smoothed = smoothedScore(6, smoothed, 0.3); // bounce back
    expect(smoothed).toBeGreaterThan(4.5);
    expect(smoothed).toBeLessThan(6); // still lagging behind the raw bounce — smoothing is working
  });

  it("tracks the raw score almost immediately at a high alpha (HIGH-impact event cycle)", () => {
    const smoothed = smoothedScore(6, 2, 0.85);
    expect(smoothed).toBeCloseTo(5.4, 4); // 0.85*6 + 0.15*2
  });

  it("clamps an out-of-range alpha into [0,1] rather than producing a nonsensical blend", () => {
    expect(smoothedScore(10, 0, 1.5)).toBe(10); // clamped to 1 -> pure new value
    expect(smoothedScore(10, 0, -0.5)).toBe(0); // clamped to 0 -> pure previous value
  });
});

describe("selectSmoothingAlpha", () => {
  it("uses the high-impact alpha only when a HIGH-impact event fired this cycle", () => {
    expect(selectSmoothingAlpha(true, 0.5, 0.85)).toBe(0.85);
    expect(selectSmoothingAlpha(false, 0.5, 0.85)).toBe(0.5);
  });
});
