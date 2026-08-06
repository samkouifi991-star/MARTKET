export function StatTile({
  label,
  value,
  sub,
  valueClassName = "",
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <div className="card p-3.5">
      <div className="text-[11px] uppercase tracking-wide text-(--text-faint)">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClassName}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-(--text-dim)">{sub}</div>}
    </div>
  );
}
