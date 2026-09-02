// Forex Scorecard index — Phase 5 of the platform redesign. Lists every
// tracked FX pair with its strength/rate/surprise differentials, trend
// labels, and real canonical score; each row links to the full breakdown.
import Link from "next/link";
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { buildAllForexScorecards } from "@/lib/pipeline/forex-scorecard";
import { HEATMAP_LABEL_CLASSES } from "@/lib/pipeline/economic-heatmap";
import { Card } from "@/components/ui/Card";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { DataFreshnessTag } from "@/components/ui/DataFreshnessTag";
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
                <td className="py-2 px-3 text-right">
                  {r.strengthDifferential !== null ? (
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${r.strengthBand ? HEATMAP_LABEL_CLASSES[r.strengthBand] : ""}`}>
                      {formatSigned(r.strengthDifferential, 0)}
                    </span>
                  ) : (
                    <DataFreshnessTag freshness="unavailable" reason="No verified economic-strength score yet for one or both currencies." />
                  )}
                </td>
                <td className="py-2 px-3 text-right">
                  {r.rateDifferentialPts !== null ? (
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${r.rateBand ? HEATMAP_LABEL_CLASSES[r.rateBand] : ""}`}>
                      {formatSigned(r.rateDifferentialPts, 2)}pt
                    </span>
                  ) : (
                    <DataFreshnessTag freshness="unavailable" reason="No verified policy-rate series yet for one or both currencies." />
                  )}
                </td>
                <td className="py-2 px-3 text-right">
                  {r.surpriseDifferential !== null ? (
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${r.surpriseBand ? HEATMAP_LABEL_CLASSES[r.surpriseBand] : ""}`}>
                      {formatSigned(r.surpriseDifferential, 1)}
                    </span>
                  ) : (
                    <DataFreshnessTag freshness="unavailable" reason="No recent economic-release surprises detected for either currency yet." />
                  )}
                </td>
                <td className="py-2 px-3 text-center text-xs">{r.dailyTrend ?? "—"}</td>
                <td className="py-2 px-3 text-center text-xs">{r.h4Trend ?? "—"}</td>
                <td className="py-2 px-3 text-center text-xs">{r.h1Trend ?? "—"}</td>
                <td className="py-2 px-3 text-right text-xs">
                  {r.retail ? `${r.retail.pctLong.toFixed(0)}% long` : <DataFreshnessTag freshness="unavailable" reason="No verified retail-sentiment provider connected for this pair yet." />}
                </td>
                <td className="py-2 pl-3 text-right">
                  {r.finalBias ? <BiasBadge bias={r.finalBias} size="sm" /> : <DataFreshnessTag freshness="unavailable" reason="Score has not been computed yet for this pair." />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
