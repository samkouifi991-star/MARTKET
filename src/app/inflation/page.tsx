// Un-gated in Phase 10 (platform redesign) — see economic-growth/page.tsx
// for the same treatment/reasoning. Reads the real per-currency inflation
// score the Economic Heatmap (Phase 6) already computes from FRED data.
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { buildEconomicHeatmap } from "@/lib/pipeline/economic-heatmap";
import { StatTile } from "@/components/ui/StatTile";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Inflation — Market Intelligence AI" };
export const dynamic = "force-dynamic";

export default async function InflationPage() {
  await requireEntitlement();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Inflation</h1>
        <p className="text-sm text-(--text-faint) mt-1">CPI, core CPI, PCE, core PCE, and PPI for the 8 tracked currencies — the same FRED-driven inflation score used in the Economic Heatmap and Economic Strength Index.</p>
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
            <p className="text-(--text-faint) text-xs leading-relaxed">Evaluated jointly with real yields, dollar strength, and rate expectations — never from inflation alone.</p>
          </div>
        </div>
      </Card>

      {isDemoOnly() ? (
        <Card>
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live.</p>
        </Card>
      ) : (
        <InflationGrid />
      )}
    </div>
  );
}

async function InflationGrid() {
  const data = await buildEconomicHeatmap(true);
  const row = data.rows.find((r) => r.factor === "Inflation")!;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {data.currencies.map((currency) => {
        const cell = row.cells[currency];
        return (
          <StatTile
            key={currency}
            label={currency}
            value={cell.value !== null ? `${cell.value > 0 ? "+" : ""}${cell.value.toFixed(1)}` : "N/A"}
            sub={cell.label ?? "Unavailable"}
            valueClassName={cell.value === null ? "" : cell.value > 0 ? "text-emerald-400" : cell.value < 0 ? "text-rose-400" : ""}
          />
        );
      })}
    </div>
  );
}
