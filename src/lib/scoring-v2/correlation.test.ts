import { describe, expect, it } from "vitest";
import { groupCorrelatedSignals } from "./correlation";

describe("groupCorrelatedSignals", () => {
  it("combines NFP + unemployment + wages into one Labor report composite, averaged not summed", () => {
    const { grouped, ungrouped } = groupCorrelatedSignals([
      { indicatorKey: "nfp", effectiveSurpriseZ: 2.0 },
      { indicatorKey: "unemploymentRate", effectiveSurpriseZ: 1.0 },
      { indicatorKey: "avgHourlyEarnings", effectiveSurpriseZ: 1.5 },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].label).toBe("Labor report");
    expect(grouped[0].effectiveSurpriseZ).toBeCloseTo(1.5, 4); // average, not sum (4.5)
    expect(ungrouped).toHaveLength(0);
  });

  it("groups CPI + Core CPI separately from PPI + Core PPI", () => {
    const { grouped } = groupCorrelatedSignals([
      { indicatorKey: "cpi", effectiveSurpriseZ: 1.0 },
      { indicatorKey: "coreCpi", effectiveSurpriseZ: 0.5 },
      { indicatorKey: "ppi", effectiveSurpriseZ: -1.0 },
      { indicatorKey: "corePpi", effectiveSurpriseZ: -0.5 },
    ]);
    const labels = grouped.map((g) => g.label).sort();
    expect(labels).toEqual(["CPI inflation", "PPI inflation"]);
  });

  it("leaves a lone release (no correlated partner present this cycle) as an independent, ungrouped signal", () => {
    const { grouped, ungrouped } = groupCorrelatedSignals([{ indicatorKey: "cpi", effectiveSurpriseZ: 1.0 }]);
    expect(grouped).toHaveLength(0);
    expect(ungrouped).toHaveLength(1);
    expect(ungrouped[0].indicatorKey).toBe("cpi");
  });

  it("leaves signals with no known correlation group entirely untouched", () => {
    const { grouped, ungrouped } = groupCorrelatedSignals([{ indicatorKey: "housingData", effectiveSurpriseZ: 0.8 }]);
    expect(grouped).toHaveLength(0);
    expect(ungrouped).toEqual([{ indicatorKey: "housingData", effectiveSurpriseZ: 0.8 }]);
  });

  it("handles a mixed cycle: one composite plus one independent signal", () => {
    const { grouped, ungrouped } = groupCorrelatedSignals([
      { indicatorKey: "cpi", effectiveSurpriseZ: 1.0 },
      { indicatorKey: "coreCpi", effectiveSurpriseZ: 1.2 },
      { indicatorKey: "housingData", effectiveSurpriseZ: -0.3 },
    ]);
    expect(grouped).toHaveLength(1);
    expect(ungrouped).toEqual([{ indicatorKey: "housingData", effectiveSurpriseZ: -0.3 }]);
  });
});
