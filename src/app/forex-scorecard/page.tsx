// Forex Scorecard index — Phase 5 of the platform redesign. Lists every
// tracked FX pair with its strength/rate/surprise differentials, trend
// labels, and real canonical score; each row links to the full breakdown.
import Link from "next/link";
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { buildAllForexScorecards } from "@/lib/pipeline/forex-scorecard";
import { Card } from "@/components/ui/Card";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { formatSigned } from "@/lib/format";

export const metadata = { title: "Forex Scorecard — Market Intelligence AI" };
export const dynamic = "force-dynamic";

export default async function ForexScorecardIndexPage() {
  await requireEntitlement();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Forex Scorecard</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Every tracked pair&apos;s economic strength differential, policy-rate differential, economic-surprise momentum, multi-timeframe trend, and retail positioning — in one view.
        </p>
      </div>

      {isDemoOnly() ? (
        <Card>
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live.</p>
        </Card>
      ) : (
        <ScorecardTable />
      )}
    </div>
  );
}

async function ScorecardTable() {
  const rows = await buildAllForexScorecards(true);

  return (
    <Card title="All pairs">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
              <th className="py-2 pr-3">Pair</th>
              <th className="py-2 px-3 text-right">Strength Δ</th>
              <th className="py-2 px-3 text-right">Rate Δ</th>
              <th className="py-2 px-3 text-right">Surprise Δ</th>
              <th className="py-2 px-3 text-center">Daily</th>
              <th className="py-2 px-3 text-center">4H</th>
              <th className="py-2 px-3 text-center">1H</th>
              <th className="py-2 px-3 text-right">Retail</th>
              <th className="py-2 pl-3 text-right">Score</th>
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
                <td className={`py-2 px-3 text-right tabular-nums ${r.strengthDifferential === null ? "text-(--text-faint)" : r.strengthDifferential > 0 ? "text-emerald-400" : r.strengthDifferential < 0 ? "text-rose-400" : ""}`}>
                  {r.strengthDifferential !== null ? formatSigned(r.strengthDifferential, 0) : "N/A"}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">{r.rateDifferentialPts !== null ? `${formatSigned(r.rateDifferentialPts, 2)}pt` : "N/A"}</td>
                <td className="py-2 px-3 text-right tabular-nums">{r.surpriseDifferential !== null ? formatSigned(r.surpriseDifferential, 1) : "N/A"}</td>
                <td className="py-2 px-3 text-center text-xs">{r.dailyTrend ?? "—"}</td>
                <td className="py-2 px-3 text-center text-xs">{r.h4Trend ?? "—"}</td>
                <td className="py-2 px-3 text-center text-xs">{r.h1Trend ?? "—"}</td>
                <td className="py-2 px-3 text-right text-xs">{r.retail ? `${r.retail.pctLong.toFixed(0)}% long` : "N/A"}</td>
                <td className="py-2 pl-3 text-right">
                  {r.finalBias ? <BiasBadge bias={r.finalBias} size="sm" /> : <span className="text-xs text-(--text-faint)">N/A</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
