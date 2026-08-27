// Geopolitical Risk Tracker — Phase 8 of the platform redesign. Fed
// entirely by manual/Zapier-ingested news that's already been classified
// (never invents an event). See lib/pipeline/geopolitical-risk.ts for the
// full decay/banding methodology.
import Link from "next/link";
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { buildGeopoliticalRisk } from "@/lib/pipeline/geopolitical-risk";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { RiskLevelBadge } from "@/components/ui/RiskLevelBadge";
import { formatRelative } from "@/lib/time";

export const metadata = { title: "Geopolitical Risk Tracker — Market Intelligence AI" };
export const dynamic = "force-dynamic";

const INTERPRETATION_CLASSES: Record<string, string> = {
  Bullish: "text-emerald-400",
  Bearish: "text-rose-400",
  Mixed: "text-amber-400",
  Neutral: "text-(--text-faint)",
  Unclear: "text-sky-400",
};

export default async function GeopoliticalRiskPage() {
  await requireEntitlement();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Geopolitical Risk Tracker</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Fed by manually entered and Zapier-forwarded news, classified by AI from the text actually supplied — never a fabricated event. Time-decayed, so a headline&apos;s influence fades as it ages.
        </p>
      </div>

      {isDemoOnly() ? (
        <Card>
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live and news ingestion is configured.</p>
        </Card>
      ) : (
        <RiskContent />
      )}
    </div>
  );
}

async function RiskContent() {
  const data = await buildGeopoliticalRisk();

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-(--text-faint)">Current Global Risk</div>
            <div className="text-2xl font-semibold tabular-nums mt-1">{data.score}</div>
          </div>
          <RiskLevelBadge level={data.level} />
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Safe-haven pressure" value={data.subScores.safeHaven.toFixed(1)} />
        <StatTile label="Energy risk" value={data.subScores.energy.toFixed(1)} />
        <StatTile label="Trade / tariff risk" value={data.subScores.tradeTariff.toFixed(1)} />
        <StatTile label="Monetary-policy risk" value={data.subScores.monetaryPolicy.toFixed(1)} />
      </div>

      <Card title="Recent high-relevance events" subtitle="Most recent first — every row traces back to a real submitted news item">
        {data.events.length === 0 ? (
          <p className="text-sm text-(--text-faint)">No high-relevance geopolitical or monetary-policy news currently on record.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
                  <th className="py-2 pr-3">Event</th>
                  <th className="py-2 px-3">Region</th>
                  <th className="py-2 px-3">Category</th>
                  <th className="py-2 px-3">Direction</th>
                  <th className="py-2 px-3">Affected markets</th>
                  <th className="py-2 px-3 text-right">Confidence</th>
                  <th className="py-2 pl-3 text-right">Age</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id} className="border-b border-(--border) last:border-0 align-top">
                    <td className="py-2 pr-3 max-w-xs truncate" title={e.headline}>{e.headline}</td>
                    <td className="py-2 px-3 text-xs text-(--text-faint)">{e.region}</td>
                    <td className="py-2 px-3 text-xs text-(--text-faint)">{e.riskCategory ?? "—"}</td>
                    <td className={`py-2 px-3 text-xs font-medium ${INTERPRETATION_CLASSES[e.interpretation] ?? ""}`}>{e.interpretation}</td>
                    <td className="py-2 px-3">
                      <div className="flex flex-wrap gap-1">
                        {e.affectedMarkets.map((m) => (
                          <Link key={m} href={`/markets/${m}`} className="text-[11px] rounded-full border border-(--border) px-1.5 py-0.5 text-(--text-dim) hover:border-(--border-strong) hover:text-(--text)">
                            {m}
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{e.confidence}</td>
                    <td className="py-2 pl-3 text-right text-xs text-(--text-faint) whitespace-nowrap">{formatRelative(e.publishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
