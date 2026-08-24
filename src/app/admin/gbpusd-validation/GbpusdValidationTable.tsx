import { ValidationRow } from "@/lib/pipeline/gbpusd-validation";
import { DataFreshnessTag } from "@/components/ui/DataFreshnessTag";
import { formatRelative } from "@/lib/time";

const IMPORTANCE_CLASSES: Record<ValidationRow["importance"], string> = {
  required: "text-(--text-dim) bg-(--bg-elevated) border border-(--border-strong)",
  optional: "text-(--text-faint) bg-(--bg-elevated) border border-(--border)",
};

export function GbpusdValidationTable({ rows }: { rows: ValidationRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[1080px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
            <th className="py-2 pr-3">Provider</th>
            <th className="py-2 px-3">Dataset</th>
            <th className="py-2 px-3">Required?</th>
            <th className="py-2 px-3">Status</th>
            <th className="py-2 px-3">Last successful fetch</th>
            <th className="py-2 px-3">Source timestamp</th>
            <th className="py-2 px-3 text-right">Records (DB)</th>
            <th className="py-2 px-3">Next scheduled refresh</th>
            <th className="py-2 pl-3">Factor using it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.provider}-${r.dataset}-${i}`} className="border-b border-(--border) last:border-0 align-top">
              <td className="py-2 pr-3 font-medium">{r.provider}</td>
              <td className="py-2 px-3">
                {r.dataset}
                {r.detail && <div className="text-[10px] text-(--text-faint) mt-0.5 max-w-xs">{r.detail}</div>}
              </td>
              <td className="py-2 px-3">
                <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium uppercase ${IMPORTANCE_CLASSES[r.importance]}`}>{r.importance}</span>
              </td>
              <td className="py-2 px-3">
                <DataFreshnessTag freshness={r.status} />
              </td>
              <td className="py-2 px-3 text-(--text-faint) text-xs">{r.lastFetch ? formatRelative(r.lastFetch) : "—"}</td>
              <td className="py-2 px-3 text-(--text-faint) text-xs">{r.sourceTimestamp ? formatRelative(r.sourceTimestamp) : "—"}</td>
              <td className="py-2 px-3 text-right tabular-nums">{r.records}</td>
              <td className="py-2 px-3 text-(--text-faint) text-xs">{r.nextScheduledRefresh ? formatRelative(r.nextScheduledRefresh) : "—"}</td>
              <td className="py-2 pl-3 text-xs text-(--text-dim)">{r.factorUsing}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
