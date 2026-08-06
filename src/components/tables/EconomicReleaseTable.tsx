import { EconomicRelease } from "@/lib/types";
import { formatDate } from "@/lib/time";
import { Card } from "@/components/ui/Card";

const TREND_CLASSES: Record<EconomicRelease["trend3m"], string> = {
  Improving: "text-emerald-400",
  Deteriorating: "text-rose-400",
  Stable: "text-(--text-faint)",
};

export function EconomicReleaseTable({ country, releases }: { country: string; releases: EconomicRelease[] }) {
  return (
    <Card title={country}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
              <th className="py-2 pr-3">Indicator</th>
              <th className="py-2 px-3 text-right">Previous</th>
              <th className="py-2 px-3 text-right">Forecast</th>
              <th className="py-2 px-3 text-right">Actual</th>
              <th className="py-2 px-3 text-right">Revision</th>
              <th className="py-2 px-3 text-right">Surprise</th>
              <th className="py-2 px-3">3m / 6m trend</th>
              <th className="py-2 px-3">Released</th>
              <th className="py-2 pl-3">Next release</th>
            </tr>
          </thead>
          <tbody>
            {releases.map((r) => (
              <tr key={r.id} className="border-b border-(--border) last:border-0 hover:bg-white/[.02]">
                <td className="py-2 pr-3 font-medium">{r.indicator}</td>
                <td className="py-2 px-3 text-right tabular-nums text-(--text-faint)">{r.previous}{r.unit}</td>
                <td className="py-2 px-3 text-right tabular-nums text-(--text-faint)">{r.forecast}{r.unit}</td>
                <td className="py-2 px-3 text-right tabular-nums font-medium">{r.actual}{r.unit}</td>
                <td className="py-2 px-3 text-right tabular-nums text-(--text-faint)">{r.revision !== null ? `${r.revision}${r.unit}` : "—"}</td>
                <td className={`py-2 px-3 text-right tabular-nums font-medium ${r.surprise > 0 ? "text-emerald-400" : r.surprise < 0 ? "text-rose-400" : "text-(--text-faint)"}`}>
                  {r.surprise > 0 ? "+" : ""}
                  {r.surprise}
                  {r.unit}
                </td>
                <td className="py-2 px-3 text-xs">
                  <span className={TREND_CLASSES[r.trend3m]}>{r.trend3m}</span>
                  <span className="text-(--text-faint)"> / </span>
                  <span className={TREND_CLASSES[r.trend6m]}>{r.trend6m}</span>
                </td>
                <td className="py-2 px-3 text-(--text-faint) text-xs">{formatDate(r.releaseDate)}</td>
                <td className="py-2 pl-3 text-(--text-faint) text-xs">{formatDate(r.nextRelease)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
