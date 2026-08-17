import { ProviderHealthRow } from "@/db/queries/provider-health";
import { formatRelative } from "@/lib/time";

const STATUS_CLASSES: Record<string, string> = {
  live: "text-emerald-400 bg-emerald-500/10",
  delayed: "text-amber-400 bg-amber-500/10",
  stale: "text-amber-400 bg-amber-500/10",
  unavailable: "text-(--text-faint) bg-slate-500/10",
  error: "text-rose-400 bg-rose-500/10",
};

export function ProviderHealthTable({ rows }: { rows: ProviderHealthRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-(--text-faint)">No provider checks recorded yet — the scheduled ingestion jobs populate this table as they run.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[820px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
            <th className="py-2 pr-3">Provider</th>
            <th className="py-2 px-3">Status</th>
            <th className="py-2 px-3">Last success</th>
            <th className="py-2 px-3">Last failure</th>
            <th className="py-2 px-3 text-right">Markets covered</th>
            <th className="py-2 px-3 text-right">Latency</th>
            <th className="py-2 pl-3 text-right">Requests today</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.provider} className="border-b border-(--border) last:border-0">
              <td className="py-2 pr-3 font-medium uppercase">{r.provider}</td>
              <td className="py-2 px-3">
                <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium ${STATUS_CLASSES[r.status] ?? STATUS_CLASSES.unavailable}`}>{r.status}</span>
                {r.lastError && <div className="text-[10px] text-rose-400 mt-1 max-w-xs truncate">{r.lastError}</div>}
              </td>
              <td className="py-2 px-3 text-(--text-faint)">{r.lastSuccessAt ? formatRelative(r.lastSuccessAt) : "—"}</td>
              <td className="py-2 px-3 text-(--text-faint)">{r.lastFailureAt ? formatRelative(r.lastFailureAt) : "—"}</td>
              <td className="py-2 px-3 text-right tabular-nums">{r.marketsCovered}</td>
              <td className="py-2 px-3 text-right tabular-nums">{r.latencyMs !== null ? `${r.latencyMs}ms` : "—"}</td>
              <td className="py-2 pl-3 text-right tabular-nums">{r.requestsToday}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
