// Un-gated in Phase 10 (platform redesign) — the OLD fabricated content
// here (meeting-implied hike/hold/cut probabilities, central-bank
// statement text) had no real data source and stays removed; this page
// now shows the real policy rate + trend per currency
// (fetchLatestRates, macro.ts) that already feeds the Economic Strength
// Index and Forex Scorecard's rate-differential rows.
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { CCY_TO_COUNTRY } from "@/lib/scoring";
import { fetchLatestRates } from "@/lib/pipeline/macro";
import { StatTile } from "@/components/ui/StatTile";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Interest Rates & Monetary Policy — Market Intelligence AI" };
export const dynamic = "force-dynamic";

export default async function InterestRatesPage() {
  await requireEntitlement();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Interest Rates &amp; Monetary Policy</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Real policy rates and recent trend direction (FRED) for the 8 tracked currencies. For currency pairs, the rate differential between the two currencies drives the interest-rate factor — see each pair&apos;s Scorecard and the Carry Trade Scanner.
        </p>
      </div>

      {isDemoOnly() ? (
        <Card>
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live.</p>
        </Card>
      ) : (
        <RatesGrid />
      )}
    </div>
  );
}

async function RatesGrid() {
  const currencies = Object.keys(CCY_TO_COUNTRY);
  const rates = await Promise.all(currencies.map((c) => fetchLatestRates(CCY_TO_COUNTRY[c], true)));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {currencies.map((currency, i) => {
        const rate = rates[i];
        const trendLabel = rate.policyRate === null ? undefined : rate.trend > 0 ? "Trending higher" : rate.trend < 0 ? "Trending lower" : "Holding steady";
        return (
          <StatTile
            key={currency}
            label={currency}
            value={rate.policyRate !== null ? `${rate.policyRate}%` : "—"}
            sub={trendLabel}
            unavailable={rate.policyRate === null ? { freshness: "unavailable", reason: `No verified FRED policy-rate series yet for ${currency}.` } : undefined}
          />
        );
      })}
    </div>
  );
}
