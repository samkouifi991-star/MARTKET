import { describe, expect, it } from "vitest";
import { classifyBiasWithHysteresis } from "./hysteresis";
import { DEFAULT_SCORING_V2_SETTINGS } from "./config";

const T = DEFAULT_SCORING_V2_SETTINGS.hysteresis; // Bullish enter 4/exit 3, Bearish enter -4/exit -3, Very* enter 8/-8 exit 6.5/-6.5

describe("classifyBiasWithHysteresis", () => {
  it("classifies fresh (no prior state) using entry thresholds like a plain threshold check", () => {
    expect(classifyBiasWithHysteresis(5, null, T)).toBe("Bullish");
    expect(classifyBiasWithHysteresis(9, null, T)).toBe("Very Bullish");
    expect(classifyBiasWithHysteresis(0, null, T)).toBe("Neutral");
    expect(classifyBiasWithHysteresis(-5, null, T)).toBe("Bearish");
  });

  it("stays Bullish once entered even as the score drifts down, as long as it stays above the exit threshold", () => {
    expect(classifyBiasWithHysteresis(4.5, "Bullish", T)).toBe("Bullish"); // entered at >=4
    expect(classifyBiasWithHysteresis(3.2, "Bullish", T)).toBe("Bullish"); // dipped below entry, still above exit (3)
    expect(classifyBiasWithHysteresis(2.9, "Bullish", T)).toBe("Neutral"); // finally crossed the exit threshold
  });

  it("does not flip to Bullish again until the score re-crosses the ENTRY threshold, not just the exit band", () => {
    // Once knocked back to Neutral, 3.5 is above exit(3) but below enter(4) — should NOT re-enter Bullish yet.
    expect(classifyBiasWithHysteresis(3.5, "Neutral", T)).toBe("Neutral");
    expect(classifyBiasWithHysteresis(4.1, "Neutral", T)).toBe("Bullish");
  });

  it("mirrors the same behavior on the bearish side", () => {
    expect(classifyBiasWithHysteresis(-4.5, "Bearish", T)).toBe("Bearish");
    expect(classifyBiasWithHysteresis(-3.2, "Bearish", T)).toBe("Bearish");
    expect(classifyBiasWithHysteresis(-2.9, "Bearish", T)).toBe("Neutral");
  });

  it("prevents the exact +6 -> +1 -> +6 flip-flop scenario the smoothing/hysteresis combo is meant to guard against", () => {
    // Bullish at +6, a noisy dip to +1 should exit (below Bullish's exit=3)...
    const afterDip = classifyBiasWithHysteresis(1, "Bullish", T);
    expect(afterDip).toBe("Neutral");
    // ...and a bounce back to +6 re-enters cleanly (well above enter=4).
    expect(classifyBiasWithHysteresis(6, afterDip, T)).toBe("Bullish");
  });

  it("allows jumping straight from Bullish to Very Bullish on a genuinely large move", () => {
    expect(classifyBiasWithHysteresis(8.5, "Bullish", T)).toBe("Very Bullish");
  });

  it("allows a Very Bullish score to downgrade straight to Bullish, not Neutral, on a moderate pullback", () => {
    // Very Bullish's exit is 6.5 — a pullback to 5 falls below it but is still >= Bullish's enter (4).
    expect(classifyBiasWithHysteresis(5, "Very Bullish", T)).toBe("Bullish");
  });

  it("falls back to plain threshold classification when hysteresis config is missing an entry", () => {
    expect(classifyBiasWithHysteresis(5, "Bullish", [])).toBe("Neutral");
  });
});
