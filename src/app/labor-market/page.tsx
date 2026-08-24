import { allEconomies } from "@/lib/demo/economies";
import { EconomicReleaseTable } from "@/components/tables/EconomicReleaseTable";
import { StatTile } from "@/components/ui/StatTile";
import { Card } from "@/components/ui/Card";
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";

export const metadata = { title: "Labor Market — Market Intelligence AI" };
export const dynamic = "force-dynamic";

// Phase 18 (public-launch demo sweep): see economic-growth/page.tsx —
// same treatment, same reason.
export default async function LaborMarketPage() {
  await requireEntitlement();
  if (!isDemoOnly()) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Labor Market</h1>
        </div>
        <Card>
          <p className="text-sm text-(--text-faint) py-6 text-center">
            Not available yet as a standalone all-country browser. Real labor-market data for each tracked market is already shown on that market&apos;s Scorecard (Jobs Market section).
          </p>
        </Card>
      </div>
    );
  }
  const economies = allEconomies();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Labor Market</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Employment change, unemployment rate, jobless claims, job openings and labor-force participation. Labor data feeds both the economic-growth score and monetary-policy expectations.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {economies.map((e) => (
          <StatTile
            key={e.country.code}
            label={e.country.name}
            value={`${e.laborScore > 0 ? "+" : ""}${e.laborScore.toFixed(1)}`}
            sub="Labor surprise score"
            valueClassName={e.laborScore > 0 ? "text-emerald-400" : e.laborScore < 0 ? "text-rose-400" : ""}
          />
        ))}
      </div>
      <div className="space-y-4">
        {economies.map((e) => (
          <EconomicReleaseTable key={e.country.code} country={e.country.name} releases={e.labor} />
        ))}
      </div>
    </div>
  );
}
