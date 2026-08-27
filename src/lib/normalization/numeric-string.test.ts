import { describe, expect, it } from "vitest";
import { normalizeNumericString } from "./numeric-string";

describe("normalizeNumericString", () => {
  it("parses a plain percent", () => {
    expect(normalizeNumericString("3.2%")).toEqual({ raw: "3.2%", value: 3.2 });
  });

  it("parses a K suffix", () => {
    expect(normalizeNumericString("320K")).toEqual({ raw: "320K", value: 320000 });
  });

  it("parses a negative K suffix", () => {
    expect(normalizeNumericString("-15K")).toEqual({ raw: "-15K", value: -15000 });
  });

  it("parses an M suffix", () => {
    expect(normalizeNumericString("1.2M")).toEqual({ raw: "1.2M", value: 1200000 });
  });

  it("parses a B suffix", () => {
    expect(normalizeNumericString("215B")).toEqual({ raw: "215B", value: 215000000000 });
  });

  it("parses a plain negative decimal", () => {
    expect(normalizeNumericString("-0.4")).toEqual({ raw: "-0.4", value: -0.4 });
  });

  it("parses a rate percent", () => {
    expect(normalizeNumericString("4.25%")).toEqual({ raw: "4.25%", value: 4.25 });
  });

  it("strips thousands separators", () => {
    expect(normalizeNumericString("1,234K")).toEqual({ raw: "1,234K", value: 1234000 });
  });

  it("returns null value for an empty string, keeping raw null", () => {
    expect(normalizeNumericString("")).toEqual({ raw: null, value: null });
  });

  it("returns null value for N/A", () => {
    expect(normalizeNumericString("N/A")).toEqual({ raw: "N/A", value: null });
  });

  it("returns null/null for null input", () => {
    expect(normalizeNumericString(null)).toEqual({ raw: null, value: null });
  });

  it("returns null/null for undefined input", () => {
    expect(normalizeNumericString(undefined)).toEqual({ raw: null, value: null });
  });

  it("never guesses on unparseable text", () => {
    expect(normalizeNumericString("tbd")).toEqual({ raw: "tbd", value: null });
  });
});
