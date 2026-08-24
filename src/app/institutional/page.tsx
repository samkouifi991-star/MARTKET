import Link from "next/link";
import { INSTRUMENTS } from "@/lib/instruments";
import { generatePositioning } from "@/lib/demo/positioning";
import { getAllLiveMarketDetails } from "@/lib/pipeline/market-detail";
import { Card } from "@/components/ui/Card";
import { formatSigned } from "@/lib/format";
import { formatDate } from "@/lib/time";
import { requireEntitlement } from "@/lib/auth/dal";
import { DATA_MODE, isDemoOnly } from "@/services/data-mode";

export const metadata = { title: "Institutional Positioning — Market Intelligence AI" };
export const dynamic = "force-dynamic";

type Row = {
  symbol: string;
  name: string;
  pos: {
    longContracts: number;
    shortContracts: number;
    netPositioning: number;
    netWeeklyChange: number;
    pctLong: number;
    openInterest: number;
    percentile: number | null;
    reportDate: string;
  } | null;
  unavailableReason: string | null;
};

export default async function InstitutionalPage() {
  await requireEntitlement();
  const demoMode = isDemoOnly();

  let rows: Row[];
  if (demoMode) {
    rows = INSTRUMENTS.map((instrument) => {
      const demo = generatePositioning(instrument);
      return { symbol: instrument.symbol, name: instrument.name, pos: demo, unavailableReason: null };
    });
  } else {
    const all = await getAllLiveMarketDetails(DATA_MODE);
    rows = all.map(({ instrument, detail }) => ({
      symbol: instrument.symbol,
      name: instrument.name,
      pos: detail.institutional.data
        ? {
            longContracts: detail.institutional.data.longContracts,
            shortContracts: detail.institutional.data.shortContracts,
            netPositioning: detail.institutional.data.netPositioning,
            netWeeklyChange: detail.institutional.data.netWeeklyChange,
            pctLong: detail.institutional.data.pctLong,
            openInterest: detail.institutional.data.openInterest,
            percentile: detail.institutional.data.percentile,
            reportDate: detail.institutional.data.reportDate,
          }
        : null,
      unavailableReason: detail.institutional.data
        ? null
        : detail.institutional.freshness === "not_applicable"
          ? "No CFTC-reportable futures contract exists for this market."
          : (detail.institutional.reason ?? "Data temporarily unavailable."),
    }));
  }

  const withData = rows.filter((r) => r.pos !== null) as (Row & { pos: NonNullable<Row["pos"]> })[];
  const strongestBuying = [...withData].sort((a, b) => b.pos.netWeeklyChange - a.pos.netWeeklyChange).slice(0, 5);
  const strongestSelling = [...withData].sort((a, b) => a.pos.netWeeklyChange - b.pos.netWeeklyChange).slice(0, 5);
  const extremeLong = withData.filter((r) => (r.pos.percentile ?? -1) >= 85).sort((a, b) => (b.pos.percentile ?? 0) - (a.pos.percentile ?? 0)).slice(0, 5);
  const extremeShort = withData.filter((r) => r.pos.percentile !== null && r.pos.percentile <= 15).sort((a, b) => (a.pos.percentile ?? 0) - (b.pos.percentile ?? 0)).slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Institutional Positioning</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Commitment-of-Traders-style large-speculator positioning. Overall net positioning and the recent weekly change are considered together — heavy long positioning is not automatically bullish if it&apos;s historically crowded.
          {!demoMode && " Markets without a CFTC-reportable futures contract, or with a currently unavailable report, are shown as such rather than estimated."}
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
                <th className="py-2 px-3 text-right">Percentile</th>
                <th className="py-2 pl-3 text-right">Report Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-b border-(--border) last:border-0 hover:bg-white/[.02]">
                  <td className="py-2 pr-3">
                    <Link href={`/markets/${r.symbol}`} className="font-medium hover:text-(--accent)">
                      {r.symbol}
                    </Link>
                  </td>
                  {r.pos ? (
                    <>
                      <td className="py-2 px-3 text-right tabular-nums">{r.pos.longContracts.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.pos.shortContracts.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.pos.netPositioning.toLocaleString()}</td>
                      <td className={`py-2 px-3 text-right tabular-nums ${r.pos.netWeeklyChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {formatSigned(r.pos.netWeeklyChange, 0)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.pos.pctLong.toFixed(0)}%</td>
                      <td className="py-2 px-3 text-right tabular-nums">{r.pos.openInterest.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {r.pos.percentile !== null ? (
                          <span className={r.pos.percentile >= 85 || r.pos.percentile <= 15 ? "text-amber-400 font-medium" : ""}>{r.pos.percentile}th</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pl-3 text-right text-(--text-faint) text-xs">{formatDate(r.pos.reportDate)}</td>
                    </>
                  ) : (
                    <td colSpan={8} className="py-2 px-3 text-(--text-faint) text-xs italic">
                      {r.unavailableReason}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function RankCard({ title, rows, metric }: { title: string; rows: (Row & { pos: NonNullable<Row["pos"]> })[]; metric: "netWeeklyChange" | "percentile" }) {
  return (
    <Card title={title}>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.symbol}>
            <Link href={`/markets/${r.symbol}`} className="flex items-center justify-between text-sm hover:text-(--accent)">
              <span className="font-medium">{r.symbol}</span>
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
