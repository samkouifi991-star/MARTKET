import { DataFreshness } from "@/lib/types";
import { formatRelative } from "@/lib/time";

const LABELS: Record<DataFreshness, { text: string; classes: string }> = {
  live: { text: "Live", classes: "text-emerald-400 bg-emerald-500/10" },
  delayed: { text: "Delayed", classes: "text-amber-400 bg-amber-500/10" },
  estimated: { text: "Estimated", classes: "text-sky-400 bg-sky-500/10" },
  stale: { text: "Stale", classes: "text-rose-400 bg-rose-500/10" },
};

export function DataFreshnessTag({ freshness, lastUpdated }: { freshness: DataFreshness; lastUpdated?: string }) {
  const meta = LABELS[freshness];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.classes}`}>
      {meta.text}
      {lastUpdated && <span className="normal-case font-normal opacity-80">· {formatRelative(lastUpdated)}</span>}
    </span>
  );
}
