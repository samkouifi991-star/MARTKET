import { describe, expect, it } from "vitest";
import { decayedContribution, sumActiveShocks, StoredEventShock } from "./event-shock";

describe("decayedContribution", () => {
  it("returns the full initial contribution at zero elapsed time", () => {
    expect(decayedContribution(1.5, 0, 36)).toBe(1.5);
  });

  it("halves at exactly one half-life", () => {
    expect(decayedContribution(1.5, 36, 36)).toBeCloseTo(0.75, 4);
  });

  it("quarters at two half-lives", () => {
    expect(decayedContribution(1.5, 72, 36)).toBeCloseTo(0.375, 4);
  });

  it("decays to exactly 0 once negligible, rather than an infinite shrinking tail", () => {
    expect(decayedContribution(1.5, 36 * 20, 36)).toBe(0);
  });

  it("decays a HIGH-tier (longer half-life) event more slowly than a LOW-tier one over the same elapsed time", () => {
    const highTierRemaining = decayedContribution(1.5, 12, 36); // HIGH default half-life
    const lowTierRemaining = decayedContribution(1.5, 12, 3); // LOW default half-life
    expect(highTierRemaining).toBeGreaterThan(lowTierRemaining);
  });

  it("preserves sign for a negative (bearish) shock", () => {
    expect(decayedContribution(-1.5, 36, 36)).toBeCloseTo(-0.75, 4);
  });
});

describe("sumActiveShocks", () => {
  const halfLives = { HIGH: 36, MEDIUM: 12, LOW: 3 };

  it("sums total-score shocks (factorKey null) separately from per-factor shocks", () => {
    const now = new Date("2027-01-15T12:00:00.000Z");
    const shocks: StoredEventShock[] = [
      { symbol: "XAUUSD", factorKey: null, initialContribution: 1.0, importanceTier: "HIGH", occurredAt: now.toISOString() },
      { symbol: "XAUUSD", factorKey: "inflation", initialContribution: 0.5, importanceTier: "MEDIUM", occurredAt: now.toISOString() },
    ];
    const result = sumActiveShocks(shocks, halfLives, now);
    expect(result.total).toBeCloseTo(1.0, 4);
    expect(result.byFactorKey.get("inflation")).toBeCloseTo(0.5, 4);
  });

  it("combines multiple shocks on the same factor", () => {
    const now = new Date("2027-01-15T12:00:00.000Z");
    const shocks: StoredEventShock[] = [
      { symbol: "XAUUSD", factorKey: "inflation", initialContribution: 0.5, importanceTier: "MEDIUM", occurredAt: now.toISOString() },
      { symbol: "XAUUSD", factorKey: "inflation", initialContribution: 0.3, importanceTier: "MEDIUM", occurredAt: now.toISOString() },
    ];
    const result = sumActiveShocks(shocks, halfLives, now);
    expect(result.byFactorKey.get("inflation")).toBeCloseTo(0.8, 4);
  });

  it("excludes a fully-decayed shock from the sum entirely", () => {
    const longAgo = new Date("2027-01-01T00:00:00.000Z");
    const now = new Date("2027-02-15T00:00:00.000Z"); // far more than 20 LOW half-lives later
    const shocks: StoredEventShock[] = [{ symbol: "XAUUSD", factorKey: null, initialContribution: 1.0, importanceTier: "LOW", occurredAt: longAgo.toISOString() }];
    const result = sumActiveShocks(shocks, halfLives, now);
    expect(result.total).toBe(0);
  });
});
