import { describe, expect, it } from "vitest";
import { countryFromCurrency } from "./zapier-country";

describe("countryFromCurrency", () => {
  it("maps every currency CCY_TO_COUNTRY knows about", () => {
    expect(countryFromCurrency("USD")).toBe("US");
    expect(countryFromCurrency("EUR")).toBe("EU");
    expect(countryFromCurrency("GBP")).toBe("GB");
    expect(countryFromCurrency("JPY")).toBe("JP");
    expect(countryFromCurrency("CHF")).toBe("CH");
    expect(countryFromCurrency("AUD")).toBe("AU");
    expect(countryFromCurrency("NZD")).toBe("NZ");
    expect(countryFromCurrency("CAD")).toBe("CA");
  });

  it("is case-insensitive", () => {
    expect(countryFromCurrency("usd")).toBe("US");
  });

  it("returns null (never guessed) for an unmapped currency", () => {
    expect(countryFromCurrency("ZAR")).toBeNull();
  });
});
