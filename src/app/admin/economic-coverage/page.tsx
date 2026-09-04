// Admin -> Economic Data Coverage — "what real macro data do we actually
// have, per currency, right now" so seeding real Forex Factory releases is
// targeted instead of guesswork. Built from lib/pipeline/economic-coverage.ts
// (2 batched queries total — see its own docs), never a live provider call.
// CURRENT/STALE are both "we have real data" (just different freshness);
// MISSING is the only state that means "nothing stored at all" — kept
// visually distinct so an admin doesn't mistake a stale-but-real cell for
// an empty one. Clicking a STALE/MISSING cell jumps to Admin Data Entry
// with currency + a suggested event name preselected.
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { buildEconomicCoverage, computeCoveragePercentage, CoverageCell, TRACKED_CURRENCIES } from "@/lib/pipeline/economic-coverage";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Economic Data Coverage — Admin — Market Intelligence AI" };
export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

const STATUS_CLASSES: Record<CoverageCell["status"], string> = {
  current: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  stale: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  missing: "bg-(--bg-elevated) text-(--text-faint) border-(--border)",
  not_applicable: "bg-(--bg-elevated) text-(--text-faint) border-(--border) opacity-50",
};

const STATUS_LABEL: Record<CoverageCell["status"], string> = { current: "CURRENT", stale: "STALE", missing: "MISSING", not_applicable: "N/A" };

function CoverageCellView({ label, currency, cell }: { label: string; currency: string; cell: CoverageCell }) {
  const badge = (
    <span
      className={`inline-flex flex-col items-center gap-0.5 rounded border px-1.5 py-1 text-[10px] font-semibold tracking-wide ${STATUS_CLASSES[cell.status]}`}
      title={
        cell.status === "not_applicable"
          ? "This indicator doesn't structurally exist for this currency — excluded from its coverage percentage, never penalized as missing."
          : cell.latestDate
            ? `${cell.source === "fred" ? "FRED macro state" : "Economic calendar"} — latest ${formatDate(cell.latestDate)}`
            : "No data stored for this currency yet"
      }
    >
      {STATUS_LABEL[cell.status]}
      {cell.latestDate && <span className="font-normal normal-case text-(--text-faint)">{formatDate(cell.latestDate)}</span>}
    </span>
  );

  if (cell.status === "current" || cell.status === "not_applicable") return <td className="py-1 px-1 text-center">{badge}</td>;

  return (
    <td className="py-1 px-1 text-center">
      <Link href={`/admin/data-entry?currency=${currency}&event=${encodeURIComponent(label)}`} className="inline-block hover:opacity-80 transition-opacity">
        {badge}
      </Link>
    </td>
  );
}

export default async function EconomicCoveragePage() {
  await requireAdmin();
  const rows = isDemoOnly() ? [] : await buildEconomicCoverage();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Economic Data Coverage</h1>
          <p className="text-sm text-(--text-faint) mt-1">What real macro data we actually have, per currency, right now — click a STALE or MISSING cell to seed it from Admin Data Entry.</p>
        </div>
        <Link href="/admin" className="text-xs text-(--accent) hover:underline">
          ← Back to Admin
        </Link>
      </div>

      <Card
        title="Coverage Grid"
        subtitle={isDemoOnly() ? "Becomes live once DATA_MODE is set to hybrid or live." : "CURRENT and STALE both mean real data is stored (just different freshness) — MISSING means nothing has ever been stored for that cell."}
        action={
          <Link href="/admin/data-entry" className="text-xs rounded-lg border border-(--border) px-3 py-1.5 font-medium hover:border-(--border-strong)">
            Add Missing Data
          </Link>
        }
      >
        {isDemoOnly() ? (
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live and a database is connected.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-(--text-faint) text-left">
                  <th className="font-medium pb-2 pr-3 sticky left-0 bg-(--bg-card)">Indicator</th>
                  {TRACKED_CURRENCIES.map((c) => (
                    <th key={c} className="font-medium pb-2 px-1 text-center">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-t border-(--border)">
                    <td className="py-1.5 pr-3 whitespace-nowrap font-medium sticky left-0 bg-(--bg-card)">{row.label}</td>
                    {TRACKED_CURRENCIES.map((c) => (
                      <CoverageCellView key={c} label={row.label} currency={c} cell={row.cells[c]} />
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-(--border-strong)">
                  <td className="py-2 pr-3 whitespace-nowrap font-semibold sticky left-0 bg-(--bg-card)" title="CURRENT=100%, STALE=50%, MISSING=0%, N/A excluded from the denominator — admin diagnostic only, never a customer market score.">
                    Coverage %
                  </td>
                  {TRACKED_CURRENCIES.map((c) => (
                    <td key={c} className="py-2 px-1 text-center font-semibold tabular-nums">
                      {computeCoveragePercentage(rows, c)}%
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
