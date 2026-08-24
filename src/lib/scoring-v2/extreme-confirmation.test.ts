import { describe, expect, it } from "vitest";
import { confirmExtremeBias, FamilyDirection } from "./extreme-confirmation";

const allBullish: FamilyDirection[] = [
  { family: "Macro", contribution: 2 },
  { family: "Positioning", contribution: 1.5 },
  { family: "Technical", contribution: 1 },
  { family: "Event", contribution: 0.5 },
];

describe("confirmExtremeBias", () => {
  it("keeps Very Bullish when confidence is high and at least 3 families confirm the direction", () => {
    expect(confirmExtremeBias("Very Bullish", 75, allBullish, 60)).toBe("Very Bullish");
  });

  it("downgrades Very Bullish to Bullish when confidence is below the configured minimum", () => {
    expect(confirmExtremeBias("Very Bullish", 42, allBullish, 60)).toBe("Bullish");
  });

  it("downgrades Very Bullish to Bullish when only one family is actually driving it (the 'one huge factor' scenario the requirement targets)", () => {
    const oneFactorDriving: FamilyDirection[] = [
      { family: "Macro", contribution: 9 },
      { family: "Positioning", contribution: 0 },
      { family: "Technical", contribution: 0.05 },
      { family: "Event", contribution: -0.1 },
    ];
    expect(confirmExtremeBias("Very Bullish", 90, oneFactorDriving, 60)).toBe("Bullish");
  });

  it("mirrors confirmation requirements for Very Bearish", () => {
    const allBearish: FamilyDirection[] = allBullish.map((f) => ({ ...f, contribution: -f.contribution }));
    expect(confirmExtremeBias("Very Bearish", 75, allBearish, 60)).toBe("Very Bearish");
    expect(confirmExtremeBias("Very Bearish", 30, allBearish, 60)).toBe("Bearish");
  });

  it("never touches Neutral, Bullish, or Bearish — confirmation only gates the two extreme tiers", () => {
    expect(confirmExtremeBias("Neutral", 10, [], 60)).toBe("Neutral");
    expect(confirmExtremeBias("Bullish", 10, [], 60)).toBe("Bullish");
    expect(confirmExtremeBias("Bearish", 10, [], 60)).toBe("Bearish");
  });

  it("requires exactly 3+ supporting families, not just a majority of however many exist", () => {
    const onlyTwo: FamilyDirection[] = [
      { family: "Macro", contribution: 3 },
      { family: "Technical", contribution: 2 },
    ];
    expect(confirmExtremeBias("Very Bullish", 90, onlyTwo, 60)).toBe("Bullish");
  });
});
