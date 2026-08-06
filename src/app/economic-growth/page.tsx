import { allEconomies } from "@/lib/demo/economies";
import { EconomicReleaseTable } from "@/components/tables/EconomicReleaseTable";
import { StatTile } from "@/components/ui/StatTile";

export const metadata = { title: "Economic Growth — Market Intelligence AI" };

export default function EconomicGrowthPage() {
  const economies = allEconomies();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Economic Growth</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          GDP, PMIs, retail sales, consumer confidence and industrial production for every tracked economy. The scoring engine compares actual vs. forecast, actual vs. previous, and the 3- and 6-month trend — and for currency pairs, compares both economies rather than one side in isolation.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {economies.map((e) => (
          <StatTile
            key={e.country.code}
            label={e.country.name}
            value={`${e.growthScore > 0 ? "+" : ""}${e.growthScore.toFixed(1)}`}
            sub="Growth surprise score"
            valueClassName={e.growthScore > 0 ? "text-emerald-400" : e.growthScore < 0 ? "text-rose-400" : ""}
          />
        ))}
      </div>
      <div className="space-y-4">
        {economies.map((e) => (
          <EconomicReleaseTable key={e.country.code} country={e.country.name} releases={e.growth} />
        ))}
      </div>
    </div>
  );
}
