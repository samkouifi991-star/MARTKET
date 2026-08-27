// Admin -> Incoming Data: shows exactly what Zapier is sending, for
// troubleshooting the email/Zapier ingestion pipeline (replaces the FMP
// economic-calendar/news dependency). Reads zapier_ingest_log directly —
// that table already carries the raw payload, dedup key, outcome, and
// recomputed-markets list for every call (accepted, duplicate, or
// rejected), so no join to economic_events/news_articles is needed to
// show the columns requested.
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { getRecentZapierIngestLog, getZapierIngestOutcomeCounts, ZapierIngestLogRow } from "@/db/queries/zapier-ingest-log";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { formatRelative } from "@/lib/time";

export const metadata = { title: "Incoming Data — Admin — Market Intelligence AI" };
export const dynamic = "force-dynamic";

function rawField(row: ZapierIngestLogRow, ...keys: string[]): string {
  const raw = row.rawPayload;
  if (!raw || typeof raw !== "object") return "—";
  for (const key of keys) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "—";
}

const OUTCOME_LABEL: Record<string, string> = {
  accepted_new: "Accepted (new)",
  accepted_duplicate: "Deduped",
  accepted_revision: "Accepted (revision)",
  accepted_unclassified: "Accepted (unclassified)",
  rejected_invalid_payload: "Rejected — invalid payload",
  rejected_unauthorized: "Rejected — unauthorized",
  rejected_rate_limited: "Rejected — rate limited",
  dry_run: "Dry run",
  error: "Error",
};

function outcomeBadgeClass(outcome: string): string {
  if (outcome.startsWith("accepted")) return "text-(--good)";
  if (outcome.startsWith("rejected") || outcome === "error") return "text-(--bad)";
  return "text-(--text-faint)";
}

export default async function IncomingDataPage() {
  await requireAdmin();

  if (isDemoOnly()) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Incoming Data</h1>
          <p className="text-sm text-(--text-faint) mt-1">Becomes live once DATA_MODE is set to hybrid or live and the Zapier webhook is configured.</p>
        </div>
      </div>
    );
  }

  const [rows, outcomeCounts] = await Promise.all([getRecentZapierIngestLog(150), getZapierIngestOutcomeCounts(7)]);
  const totalLast7d = Object.values(outcomeCounts).reduce((a, b) => a + b, 0);
  const duplicates = outcomeCounts["accepted_duplicate"] ?? 0;
  const rejected = Object.entries(outcomeCounts)
    .filter(([k]) => k.startsWith("rejected"))
    .reduce((a, [, v]) => a + v, 0);
  const errors = outcomeCounts["error"] ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Incoming Data</h1>
          <p className="text-sm text-(--text-faint) mt-1">Every call the Zapier ingestion webhook has received — economic releases and news, accepted or rejected.</p>
        </div>
        <Link href="/admin" className="text-xs text-(--accent) hover:underline">
          ← Back to Admin
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Received (7d)" value={totalLast7d.toLocaleString()} />
        <StatTile label="Deduped (7d)" value={duplicates.toLocaleString()} />
        <StatTile label="Rejected (7d)" value={rejected.toLocaleString()} />
        <StatTile label="Errors (7d)" value={errors.toLocaleString()} />
      </div>

      <Card title="Recent Zapier calls" subtitle="Most recent first — includes rejected/invalid calls for full traceability">
        {rows.length === 0 ? (
          <p className="text-sm text-(--text-faint)">No Zapier calls received yet. Configure the webhook at POST /api/integrations/zapier/market-event.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-(--text-faint) border-b border-(--border)">
                  <th className="py-2 pr-3 font-medium">Received</th>
                  <th className="py-2 pr-3 font-medium">Channel</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Source</th>
                  <th className="py-2 pr-3 font-medium">Event / Headline</th>
                  <th className="py-2 pr-3 font-medium">Currency</th>
                  <th className="py-2 pr-3 font-medium">Impact</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Markets affected</th>
                  <th className="py-2 pr-3 font-medium">Recomputed</th>
                  <th className="py-2 pr-3 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-(--border) last:border-0 align-top">
                    <td className="py-2 pr-3 text-xs text-(--text-faint) whitespace-nowrap">{formatRelative(row.receivedAt)}</td>
                    <td className="py-2 pr-3 text-xs">{row.channel === "manual" ? "Manual (Admin)" : "Zapier"}</td>
                    <td className="py-2 pr-3">{row.payloadType}</td>
                    <td className="py-2 pr-3 text-(--text-faint)">{rawField(row, "source")}</td>
                    <td className="py-2 pr-3 max-w-xs truncate" title={rawField(row, "event", "headline")}>
                      {rawField(row, "event", "headline")}
                    </td>
                    <td className="py-2 pr-3">{rawField(row, "currency")}</td>
                    <td className="py-2 pr-3">{rawField(row, "impact")}</td>
                    <td className={`py-2 pr-3 font-medium ${outcomeBadgeClass(row.outcome)}`}>{OUTCOME_LABEL[row.outcome] ?? row.outcome}</td>
                    <td className="py-2 pr-3 text-xs text-(--text-faint)">{row.recomputedMarkets.length > 0 ? row.recomputedMarkets.join(", ") : "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">{row.recomputedMarkets.length}</td>
                    <td className="py-2 pr-3 max-w-xs truncate text-(--bad) text-xs" title={row.errorDetail ?? undefined}>
                      {row.errorDetail ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
