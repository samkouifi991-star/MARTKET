// Economic Heatmap — Phase 6 of the platform redesign. 8 tracked
// currencies × 5 macro factors, each cell banded Strong bullish..Strong
// bearish. See lib/pipeline/economic-heatmap.ts for the full methodology.
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { buildEconomicHeatmap, HeatmapLabel } from "@/lib/pipeline/economic-heatmap";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Economic Heatmap — Market Intelligence AI" };
export const dynamic = "force-dynamic";

const LABEL_CLASSES: Record<HeatmapLabel, string> = {
  "Strong bullish": "bg-emerald-500/25 text-emerald-300",
  Bullish: "bg-emerald-500/10 text-emerald-400",
  Neutral: "bg-slate-500/10 text-(--text-faint)",
  Bearish: "bg-rose-500/10 text-rose-400",
  "Strong bearish": "bg-rose-500/25 text-rose-300",
};

export default async function EconomicHeatmapPage() {
  await requireEntitlement();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Economic Heatmap</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Growth, inflation, labor, relative policy-rate positioning, and recent economic-surprise momentum for the 8 tracked currencies — real data, banded for quick scanning.
        </p>
      </div>

      {isDemoOnly() ? (
        <Card>
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live.</p>
        </Card>
      ) : (
        <HeatmapTable />
      )}
    </div>
  );
}

async function HeatmapTable() {
  const data = await buildEconomicHeatmap(true);

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
              <th className="py-2 pr-3">Factor</th>
              {data.currencies.map((c) => (
                <th key={c} className="py-2 px-2 text-center">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.factor} className="border-b border-(--border) last:border-0">
                <td className="py-2 pr-3 font-medium text-xs">{row.factor}</td>
                {data.currencies.map((c) => {
                  const cell = row.cells[c];
                  return (
                    <td key={c} className="py-1.5 px-2">
                      <div className={`rounded-md px-2 py-1.5 text-center text-[11px] font-medium ${cell.label ? LABEL_CLASSES[cell.label] : "text-(--text-faint)"}`}>
                        {cell.value !== null ? cell.value.toFixed(1) : "N/A"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
