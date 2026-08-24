import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/db/queries/scoring-config");

import { getActiveScoringConfiguration } from "@/db/queries/scoring-config";
import { resolveActiveScoringConfig } from "./scoring-config";
import { DEFAULT_FACTOR_WEIGHTS, DEFAULT_BIAS_THRESHOLDS } from "@/lib/config";

describe("resolveActiveScoringConfig — bootstrap fallback", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the saved active configuration when one exists", async () => {
    vi.mocked(getActiveScoringConfiguration).mockResolvedValue({
      id: 7,
      weights: { ...DEFAULT_FACTOR_WEIGHTS, technical: 0.3 },
      biasThresholds: DEFAULT_BIAS_THRESHOLDS,
      v2Settings: null,
      createdBy: "admin@test.com",
      createdAt: new Date(),
    });

    const resolved = await resolveActiveScoringConfig();
    expect(resolved.id).toBe(7);
    expect(resolved.weights.technical).toBe(0.3);
  });

  it("falls back to the hardcoded bootstrap defaults when no configuration has ever been saved", async () => {
    vi.mocked(getActiveScoringConfiguration).mockResolvedValue(null);
    const resolved = await resolveActiveScoringConfig();
    expect(resolved.id).toBeNull();
    expect(resolved.weights).toEqual(DEFAULT_FACTOR_WEIGHTS);
    expect(resolved.biasThresholds).toEqual(DEFAULT_BIAS_THRESHOLDS);
  });

  it("falls back to the bootstrap defaults on a database read failure, never breaking score computation", async () => {
    vi.mocked(getActiveScoringConfiguration).mockRejectedValue(new Error("Neon unreachable"));
    const resolved = await resolveActiveScoringConfig();
    expect(resolved.id).toBeNull();
    expect(resolved.weights).toEqual(DEFAULT_FACTOR_WEIGHTS);
  });
});
