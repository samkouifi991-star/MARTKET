import { DataFreshness } from "@/lib/types";
import { DataFreshnessTag } from "./DataFreshnessTag";

export function StatTile({
  label,
  value,
  sub,
  valueClassName = "",
  unavailable,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
  // Standardized replacement for a bare "N/A" value string — renders "—"
  // plus the shared freshness badge (with an optional hover reason)
  // instead, so every "no value" StatTile across the app reads the same
  // way. Takes priority over `value`/`sub` when set.
  unavailable?: { freshness: DataFreshness; reason?: string };
}) {
  return (
    <div className="card p-3.5">
      <div className="text-[11px] uppercase tracking-wide text-(--text-faint)">{label}</div>
      {unavailable ? (
        <div className="mt-1.5">
          <DataFreshnessTag freshness={unavailable.freshness} reason={unavailable.reason} />
        </div>
      ) : (
        <>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClassName}`}>{value}</div>
          {sub && <div className="mt-0.5 text-xs text-(--text-dim)">{sub}</div>}
        </>
      )}
    </div>
  );
}
