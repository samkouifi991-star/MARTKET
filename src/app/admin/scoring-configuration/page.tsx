// Admin -> Scoring Configuration — extracted from the admin/page.tsx
// dashboard into its own route (Phase 10 of the platform redesign) so
// it's a real nav destination, not a scroll-to section. Same
// AdminClient/data loading as before, just relocated.
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { listScoringConfigurationVersions } from "@/db/queries/scoring-config";
import { resolveActiveScoringConfig } from "@/lib/pipeline/scoring-config";
import { AUDIT_LOGS, AuditLogEntry } from "@/lib/demo/admin";
import { AdminClient } from "../AdminClient";

export const metadata = { title: "Scoring Configuration — Admin — Market Intelligence AI" };
export const dynamic = "force-dynamic";

export default async function ScoringConfigurationPage() {
  await requireAdmin();
  const activeScoringConfig = await resolveActiveScoringConfig();
  const demoMode = isDemoOnly();
  const auditLog: AuditLogEntry[] = demoMode
    ? AUDIT_LOGS
    : (await listScoringConfigurationVersions(20)).map((v) => ({
        id: String(v.id),
        actor: v.createdBy,
        action: "Saved scoring configuration",
        detail: v.includesV2Settings ? "V1 weights, bias thresholds, and V2 tuning settings" : "V1 weights and bias thresholds",
        at: v.createdAt.toISOString(),
      }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Scoring Configuration</h1>
          <p className="text-sm text-(--text-faint) mt-1">Factor weights, bias thresholds, and Scoring Engine V2 tuning — every edit here is versioned.</p>
        </div>
        <Link href="/admin" className="text-xs text-(--accent) hover:underline">
          ← Back to Admin
        </Link>
      </div>

      <AdminClient initialAuditLog={auditLog} activeScoringConfig={activeScoringConfig} />
    </div>
  );
}
