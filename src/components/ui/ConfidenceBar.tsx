export function ConfidenceBar({ value, compact = false }: { value: number; compact?: boolean }) {
  const color = value >= 70 ? "bg-emerald-400" : value >= 45 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className={compact ? "w-16" : "w-full"}>
      <div className="flex items-center justify-between text-[11px] text-(--text-faint) mb-1">
        {!compact && <span>Confidence</span>}
        <span className="text-(--text-dim) font-medium">{value}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-(--border)">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
