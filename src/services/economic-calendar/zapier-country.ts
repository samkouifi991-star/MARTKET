// Currency code ("USD","EUR",...) -> the same short country-code space
// CCY_TO_COUNTRY/affectedMarketsFor/releaseKeyFor/scorecard.ts's
// primaryMacroCountry all already use ("US","EU",...). A thin wrapper
// (not a new mapping) so the Zapier ingestion path stays byte-identical
// to how every other reader resolves country identity.
import { CCY_TO_COUNTRY } from "@/lib/scoring";

/** Returns null (never guessed) for a currency this app doesn't track a
 * country for — the release is still stored (processingStatus stays
 * "unclassified"-eligible upstream), just never surprise-scored. */
export function countryFromCurrency(currency: string): string | null {
  return CCY_TO_COUNTRY[currency.toUpperCase()] ?? null;
}
