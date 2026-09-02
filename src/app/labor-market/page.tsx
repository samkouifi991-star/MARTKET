// Un-gated in Phase 10 (platform redesign) — see economic-growth/page.tsx
// for the same treatment/reasoning. Reads the real per-currency labor
// score the Economic Heatmap (Phase 6) already computes from FRED data.
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { buildEconomicHeatmap } from "@/lib/pipeline/economic-heatmap";
import { StatTile } from "@/components/ui/StatTile";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Labor Market — Market Intelligence AI" };
export const dynamic = "force-dynamic";

export default async function LaborMarketPage() {
  await requireEntitlement();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Labor Market</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Unemployment rate, payrolls, initial claims, wage growth, and labor participation for the 8 tracked currencies — the same FRED-driven labor score used in the Economic Heatmap and Economic Strength Index.
        </p>
      </div>

      {isDemoOnly() ? (
        <Card>
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live.</p>
        </Card>
      ) : (
        <LaborGrid />
      )}
    </div>
  );
}

async function LaborGrid() {
  const data = await buildEconomicHeatmap(true);
  const row = data.rows.find((r) => r.factor === "Labor")!;

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
