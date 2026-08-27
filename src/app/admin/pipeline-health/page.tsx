// Admin -> Pipeline Health — extracted from the admin/page.tsx dashboard
// into its own route (Phase 10 of the platform redesign) so it's a real
// nav destination, not a scroll-to section. Same data/logic as before
// (buildPipelineHealthReport/buildStaleDataAlerts), just relocated.
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/dal";
import { DATA_MODE } from "@/services/data-mode";
import { buildPipelineHealthReport, buildStaleDataAlerts, PipelineHealthRow } from "@/lib/pipeline/pipeline-health";
import { PipelineHealthTable } from "../PipelineHealthTable";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Pipeline Health — Admin — Market Intelligence AI" };
export const dynamic = "force-dynamic";

async function loadPipelineHealth(): Promise<{ rows: PipelineHealthRow[]; error: string | null }> {
  if (DATA_MODE === "demo") return { rows: [], error: null };
  try {
    return { rows: await buildPipelineHealthReport(), error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function PipelineHealthPage() {
  await requireAdmin();
  const { rows: pipelineHealthRows, error: pipelineHealthError } = await loadPipelineHealth();
  const staleDataAlerts = buildStaleDataAlerts(pipelineHealthRows);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Pipeline Health</h1>
          <p className="text-sm text-(--text-faint) mt-1">Per-market freshness age for every dataset feeding the score, and stale-data alerts beyond each dataset&apos;s established SLA.</p>
        </div>
        <Link href="/admin" className="text-xs text-(--accent) hover:underline">
          ← Back to Admin
        </Link>
      </div>

      <Card
        title="Stale Data Alerts"
        subtitle="Admin-only — never shown to customers. Every field beyond its dataset&apos;s established SLA, from the same read as the Data Pipeline Health table below."
      >
        {DATA_MODE === "demo" ? (
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live.</p>
        ) : pipelineHealthError ? (
          <p className="text-sm text-rose-400">Data temporarily unavailable: {pipelineHealthError}</p>
        ) : staleDataAlerts.length === 0 ? (
          <p className="text-sm text-emerald-400">No stale data — every launch market&apos;s pipeline is within SLA.</p>
        ) : (
          <ul className="space-y-1.5">
            {staleDataAlerts.map((a, i) => (
              <li key={`${a.symbol}-${a.dataset}-${i}`} className="flex items-center justify-between text-sm border-b border-(--border) last:border-0 pb-1.5 last:pb-0">
                <span>
                  <Link href={`/markets/${a.symbol}`} className="font-medium hover:text-(--accent)">{a.symbol}</Link>
                  <span className="text-(--text-faint)"> · {a.dataset}</span>
                </span>
                <span className="text-xs text-rose-400 font-medium uppercase tracking-wide">
                  {a.status}
                  {a.ageHours !== null && ` · ${Math.round(a.ageHours)}h`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Data Pipeline Health"
        subtitle={
          DATA_MODE === "demo"
            ? "Becomes live once DATA_MODE is set to hybrid or live"
            : "Per-market freshness age for every dataset feeding the score — highlighted cells are beyond that dataset's own established SLA"
        }
      >
        {DATA_MODE === "demo" ? (
          <p className="text-sm text-(--text-faint)">Pipeline health is populated by the scheduled ingestion jobs once DATA_MODE is hybrid or live. Currently running in demo mode — nothing to show.</p>
        ) : pipelineHealthError ? (
          <p className="text-sm text-rose-400">Data temporarily unavailable: {pipelineHealthError}</p>
        ) : (
          <PipelineHealthTable rows={pipelineHealthRows} />
        )}
      </Card>
    </div>
  );
}
