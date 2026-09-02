// Carry Trade Scanner — Phase 7 of the platform redesign. Ranks FX pairs
// by policy-rate differential and checks whether that carry is
// fundamentally supported by Economic Strength or fighting the trend.
import Link from "next/link";
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { buildCarryTradeScanner, CarrySupport } from "@/lib/pipeline/carry-trade";
import { Card } from "@/components/ui/Card";
import { DataFreshnessTag } from "@/components/ui/DataFreshnessTag";
import { formatSigned } from "@/lib/format";

export const metadata = { title: "Carry Trade Scanner — Market Intelligence AI" };
export const dynamic = "force-dynamic";

const SUPPORT_CLASSES: Record<CarrySupport, string> = {
  Supported: "text-emerald-400 bg-emerald-500/10",
  "Fighting the trend": "text-rose-400 bg-rose-500/10",
  Mixed: "text-amber-400 bg-amber-500/10",
  Unknown: "text-(--text-faint) bg-slate-500/10",
};

export default async function CarryTradePage() {
  await requireEntitlement();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Carry Trade Scanner</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          FX pairs ranked by policy-rate differential — the carry — checked against the Economic Strength differential to see whether the carry is fundamentally supported or fighting the trend.
        </p>
      </div>

      {isDemoOnly() ? (
        <Card>
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live.</p>
        </Card>
      ) : (
        <CarryTable />
      )}
    </div>
  );
}

async function CarryTable() {
  const rows = await buildCarryTradeScanner(true);

  return (
    <Card title="Ranked by carry magnitude">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
              <th className="py-2 pr-3">Pair</th>
              <th className="py-2 px-3 text-right">Rate Δ</th>
              <th className="py-2 px-3">Carry direction</th>
              <th className="py-2 px-3 text-right">Strength Δ</th>
              <th className="py-2 pl-3">Fundamental support</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-(--border) last:border-0 hover:bg-white/[.02]">
                <td className="py-2 pr-3">
                  <Link href={`/forex-scorecard/${r.symbol}`} className="font-medium hover:text-(--accent)">
                    {r.base}/{r.quote}
                  </Link>
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {r.rateDifferentialPts !== null ? `${formatSigned(r.rateDifferentialPts, 2)}pt` : <DataFreshnessTag freshness="unavailable" reason="No verified policy-rate series yet for one or both currencies." />}
                </td>
                <td className="py-2 px-3 text-xs">
                  {r.carryDirection ? (
                    `${r.carryDirection === "Long base" ? r.base : r.carryDirection === "Long quote" ? r.quote : "—"}${r.carryDirection === "Flat" ? " (flat)" : ""}`
                  ) : (
                    <DataFreshnessTag freshness="unavailable" reason="No verified policy-rate series yet for one or both currencies." />
                  )}
                </td>
                <td className={`py-2 px-3 text-right tabular-nums ${r.strengthDifferential === null ? "text-(--text-faint)" : r.strengthDifferential > 0 ? "text-emerald-400" : r.strengthDifferential < 0 ? "text-rose-400" : ""}`}>
                  {r.strengthDifferential !== null ? formatSigned(r.strengthDifferential, 0) : <DataFreshnessTag freshness="unavailable" reason="No verified economic-strength score yet for one or both currencies." />}
                </td>
                <td className="py-2 pl-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${SUPPORT_CLASSES[r.support]}`}>{r.support}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
