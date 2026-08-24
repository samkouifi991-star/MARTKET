import Link from "next/link";
import { INSTRUMENTS } from "@/lib/instruments";
import { generatePositioning } from "@/lib/demo/positioning";
import { Card } from "@/components/ui/Card";
import { formatSigned } from "@/lib/format";
import { formatDate } from "@/lib/time";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Institutional Positioning — Market Intelligence AI" };

export default async function InstitutionalPage() {
  await requireEntitlement();
  const rows = INSTRUMENTS.map((instrument) => ({ instrument, pos: generatePositioning(instrument) }));

  const strongestBuying = [...rows].sort((a, b) => b.pos.netWeeklyChange - a.pos.netWeeklyChange).slice(0, 5);
  const strongestSelling = [...rows].sort((a, b) => a.pos.netWeeklyChange - b.pos.netWeeklyChange).slice(0, 5);
  const extremeLong = [...rows].filter((r) => r.pos.percentile >= 85).sort((a, b) => b.pos.percentile - a.pos.percentile).slice(0, 5);
  const extremeShort = [...rows].filter((r) => r.pos.percentile <= 15).sort((a, b) => a.pos.percentile - b.pos.percentile).slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Institutional Positioning</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Commitment-of-Traders-style large-speculator positioning. Overall net positioning and the recent weekly change are considered together — heavy long positioning is not automatically bullish if it&apos;s historically crowded.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <RankCard title="Strongest institutional buying" rows={strongestBuying} metric="netWeeklyChange" />
        <RankCard title="Strongest institutional selling" rows={strongestSelling} metric="netWeeklyChange" />
        <RankCard title="Extreme long positioning" rows={extremeLong} metric="percentile" />
        <RankCard title="Extreme short positioning" rows={extremeShort} metric="percentile" />
      </div>

      <Card title="All markets">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
                <th className="py-2 pr-3">Market</th>
                <th className="py-2 px-3 text-right">Long</th>
                <th className="py-2 px-3 text-right">Short</th>
                <th className="py-2 px-3 text-right">Net</th>
                <th className="py-2 px-3 text-right">Weekly Δ Net</th>
                <th className="py-2 px-3 text-right">% Long</th>
                <th className="py-2 px-3 text-right">Open Interest</th>
                <th className="py-2 px-3 text-right">Δ OI</th>
                <th className="py-2 px-3 text-right">Percentile</th>
                <th className="py-2 pl-3 text-right">Report Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.instrument.symbol} className="border-b border-(--border) last:border-0 hover:bg-white/[.02]">
                  <td className="py-2 pr-3">
                    <Link href={`/markets/${r.instrument.symbol}`} className="font-medium hover:text-(--accent)">
                      {r.instrument.symbol}
                    </Link>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.pos.longContracts.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.pos.shortContracts.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.pos.netPositioning.toLocaleString()}</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${r.pos.netWeeklyChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {formatSigned(r.pos.netWeeklyChange, 0)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.pos.pctLong.toFixed(0)}%</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.pos.openInterest.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{formatSigned(r.pos.changeOpenInterest, 0)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    <span className={r.pos.percentile >= 85 || r.pos.percentile <= 15 ? "text-amber-400 font-medium" : ""}>{r.pos.percentile}th</span>
                  </td>
                  <td className="py-2 pl-3 text-right text-(--text-faint) text-xs">{formatDate(r.pos.reportDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function RankCard({
  title,
  rows,
  metric,
}: {
  title: string;
  rows: { instrument: { symbol: string }; pos: { netWeeklyChange: number; percentile: number } }[];
  metric: "netWeeklyChange" | "percentile";
}) {
  return (
    <Card title={title}>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.instrument.symbol}>
            <Link href={`/markets/${r.instrument.symbol}`} className="flex items-center justify-between text-sm hover:text-(--accent)">
              <span className="font-medium">{r.instrument.symbol}</span>
              <span className="tabular-nums text-(--text-dim)">
                {metric === "netWeeklyChange" ? formatSigned(r.pos.netWeeklyChange, 0) : `${r.pos.percentile}th pct`}
              </span>
            </Link>
          </li>
        ))}
        {rows.length === 0 && <p className="text-xs text-(--text-faint)">None currently.</p>}
      </ul>
    </Card>
  );
}
