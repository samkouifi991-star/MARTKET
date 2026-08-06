import { allEconomies } from "@/lib/demo/economies";
import { EconomicReleaseTable } from "@/components/tables/EconomicReleaseTable";
import { StatTile } from "@/components/ui/StatTile";

export const metadata = { title: "Labor Market — Market Intelligence AI" };

export default function LaborMarketPage() {
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
