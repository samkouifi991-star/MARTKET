// Maps an economic release's country to the instruments it affects — shared
// by the V1 calendar cron (app/api/cron/calendar/route.ts) and V2's release
// engine (app/api/cron/economic-releases/route.ts), so both crons agree on
// exactly which markets a given country's release touches.
import { INSTRUMENTS } from "@/lib/instruments";

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  "United States": "USD",
  US: "USD",
  Eurozone: "EUR",
  EU: "EUR",
  "United Kingdom": "GBP",
  GB: "GBP",
  Japan: "JPY",
  JP: "JPY",
  Switzerland: "CHF",
  CH: "CHF",
  Australia: "AUD",
  AU: "AUD",
  "New Zealand": "NZD",
  NZ: "NZD",
  Canada: "CAD",
  CA: "CAD",
};

export function affectedMarketsFor(country: string): string[] {
  const currency = COUNTRY_TO_CURRENCY[country];
  if (!currency) return [];
  const markets = INSTRUMENTS.filter((i) => i.currencies?.includes(currency)).map((i) => i.symbol);
  // USD releases also move gold, silver and the major indices — a stronger
  // structural link than the generic currency-pair match above.
  if (currency === "USD") markets.push("XAUUSD", "XAGUSD", "SPX500", "NAS100", "DJ30", "RUT2000");
  return Array.from(new Set(markets));
}

/** The ISO-ish country code (matches CCY_TO_COUNTRY/FRED country keys, e.g.
 * "US", "GB") for a release's raw country label, when known. Distinct from
 * affectedMarketsFor's currency mapping since a couple of countries (DE)
 * matter for macro data but aren't a currency's own base country. */
export function countryCodeFor(rawCountry: string): string | null {
  const currency = COUNTRY_TO_CURRENCY[rawCountry];
  if (currency === "USD") return "US";
  if (currency === "EUR") return "EU";
  if (currency === "GBP") return "GB";
  if (currency === "JPY") return "JP";
  if (currency === "CHF") return "CH";
  if (currency === "AUD") return "AU";
  if (currency === "NZD") return "NZ";
  if (currency === "CAD") return "CA";
  if (rawCountry === "Germany" || rawCountry === "DE") return "DE";
  return null;
}
