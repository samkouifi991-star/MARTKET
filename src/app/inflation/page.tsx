import { allEconomies } from "@/lib/demo/economies";
import { EconomicReleaseTable } from "@/components/tables/EconomicReleaseTable";
import { StatTile } from "@/components/ui/StatTile";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Inflation — Market Intelligence AI" };

export default function InflationPage() {
  const economies = allEconomies();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Inflation</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          CPI, core CPI, PPI, and wage growth for every tracked economy.
        </p>
      </div>

      <Card title="Inflation is scored differently per asset class">
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="font-medium mb-1">Currencies</div>
            <p className="text-(--text-faint) text-xs leading-relaxed">
              Rising inflation can support a currency when it raises the odds of tighter policy; falling inflation can weaken it when it raises the odds of cuts. Scored as a differential vs. the counter-currency.
            </p>
          </div>
          <div>
            <div className="font-medium mb-1">Equities</div>
            <p className="text-(--text-faint) text-xs leading-relaxed">
              Moderating inflation is treated as positive (lower rate pressure); persistently high inflation is treated as a headwind via higher borrowing costs.
            </p>
          </div>
          <div>
            <div className="font-medium mb-1">Gold &amp; precious metals</div>
            <p className="text-(--text-faint) text-xs leading-relaxed">
              Evaluated jointly with real yields, dollar strength, and rate expectations — never from inflation alone.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {economies.map((e) => (
          <StatTile
            key={e.country.code}
            label={e.country.name}
            value={e.inflationTrend}
            sub={`Surprise score ${e.inflationScore > 0 ? "+" : ""}${e.inflationScore.toFixed(1)}`}
            valueClassName={e.inflationTrend === "Rising" ? "text-amber-400" : e.inflationTrend === "Falling" ? "text-sky-400" : ""}
          />
        ))}
      </div>

      <div className="space-y-4">
        {economies.map((e) => (
          <EconomicReleaseTable key={e.country.code} country={e.country.name} releases={e.inflation} />
        ))}
      </div>
    </div>
  );
}
