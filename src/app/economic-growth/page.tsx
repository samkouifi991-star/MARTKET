// Un-gated in Phase 10 (platform redesign) — previously demo-only because
// this page's old "Growth surprise score" was an invented composite with
// no real equivalent. Now reads the exact same real per-currency growth
// score the Economic Heatmap (Phase 6) already computes from FRED data
// via fetchCountryScores — same building block, not a fourth data path.
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { buildEconomicHeatmap } from "@/lib/pipeline/economic-heatmap";
import { StatTile } from "@/components/ui/StatTile";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Economic Growth — Market Intelligence AI" };
export const dynamic = "force-dynamic";

export default async function EconomicGrowthPage() {
  await requireEntitlement();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Economic Growth</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Real GDP, industrial production, and retail sales for the 8 tracked currencies — the same FRED-driven growth score used in the Economic Heatmap and Economic Strength Index.
        </p>
      </div>

      {isDemoOnly() ? (
        <Card>
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live.</p>
        </Card>
      ) : (
        <GrowthGrid />
      )}
    </div>
  );
}

async function GrowthGrid() {
  const data = await buildEconomicHeatmap(true);
  const row = data.rows.find((r) => r.factor === "Growth")!;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {data.currencies.map((currency) => {
        const cell = row.cells[currency];
        return (
          <StatTile
            key={currency}
            label={currency}
            value={cell.value !== null ? `${cell.value > 0 ? "+" : ""}${cell.value.toFixed(1)}` : "—"}
            sub={cell.label ?? undefined}
            valueClassName={cell.value === null ? "" : cell.value > 0 ? "text-emerald-400" : cell.value < 0 ? "text-rose-400" : ""}
            unavailable={cell.value === null ? { freshness: "unavailable", reason: `No verified data yet for ${currency}.` } : undefined}
          />
        );
      })}
    </div>
  );
}
