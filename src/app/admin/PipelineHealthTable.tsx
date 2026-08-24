import { PipelineHealthField, PipelineHealthRow } from "@/lib/pipeline/pipeline-health";

const STATUS_CLASSES: Record<string, string> = {
  live: "text-emerald-400",
  delayed: "text-amber-400",
  stale: "text-rose-400",
  unavailable: "text-(--text-faint)",
  error: "text-rose-400",
  not_applicable: "text-(--text-faint) opacity-60",
};

function Cell({ field }: { field: PipelineHealthField }) {
  const classes = STATUS_CLASSES[field.status] ?? STATUS_CLASSES.unavailable;
  const age = field.ageHours === null ? "—" : field.ageHours < 1 ? "<1h" : `${Math.round(field.ageHours)}h`;
  return (
    <td className={`py-1.5 px-2 text-right tabular-nums ${field.beyondSla ? "bg-rose-500/10 font-semibold" : ""} ${classes}`} title={field.status}>
      {age}
    </td>
  );
}

const COLUMNS: { key: keyof PipelineHealthRow; label: string }[] = [
  { key: "price", label: "Price" },
  { key: "dailyCandle", label: "Daily" },
  { key: "h4Candle", label: "H4" },
  { key: "h1Candle", label: "H1" },
  { key: "cftcReport", label: "CFTC" },
  { key: "retailSentiment", label: "Retail" },
  { key: "macro", label: "Macro" },
  { key: "scoreComputation", label: "Score" },
];

export function PipelineHealthTable({ rows }: { rows: PipelineHealthRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-(--text-faint)">No launch-ready markets to report on.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
            <th className="py-2 pr-3">Market</th>
            {COLUMNS.map((c) => (
              <th key={c.key} className="py-2 px-2 text-right">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="border-b border-(--border) last:border-0">
              <td className="py-1.5 pr-3 font-medium">{r.symbol}</td>
              {COLUMNS.map((c) => (
                <Cell key={c.key} field={r[c.key] as PipelineHealthField} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-(--text-faint) mt-2">
        Age since each dataset&apos;s own last real observation (not page-render time). Highlighted cells are beyond that dataset&apos;s established freshness SLA — hover a cell for its exact status.
      </p>
    </div>
  );
}
