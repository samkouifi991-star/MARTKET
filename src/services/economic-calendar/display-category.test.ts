import { describe, expect, it } from "vitest";
import { deriveDisplayCategory } from "./display-category";

describe("deriveDisplayCategory", () => {
  it("returns other for null (unclassified) events", () => {
    expect(deriveDisplayCategory(null)).toBe("other");
  });

  it("categorizes inflation indicators", () => {
    expect(deriveDisplayCategory("cpi")).toBe("inflation");
    expect(deriveDisplayCategory("corePce")).toBe("inflation");
  });

  it("categorizes labor indicators", () => {
    expect(deriveDisplayCategory("nfp")).toBe("labor");
    expect(deriveDisplayCategory("jolts")).toBe("labor");
  });

  it("categorizes growth indicators", () => {
    expect(deriveDisplayCategory("gdp")).toBe("growth");
  });

  it("categorizes consumption indicators", () => {
    expect(deriveDisplayCategory("retailSales")).toBe("consumption");
    expect(deriveDisplayCategory("michiganSentiment")).toBe("consumption");
  });

  it("categorizes manufacturing indicators", () => {
    expect(deriveDisplayCategory("ismManufacturing")).toBe("manufacturing");
  });

  it("categorizes services indicators", () => {
    expect(deriveDisplayCategory("ismServices")).toBe("services");
  });

  it("categorizes housing indicators", () => {
    expect(deriveDisplayCategory("housingData")).toBe("housing");
  });

  it("categorizes central-bank indicators", () => {
    expect(deriveDisplayCategory("fedRateDecision")).toBe("central_bank");
    expect(deriveDisplayCategory("ecbRateDecision")).toBe("central_bank");
  });
});
