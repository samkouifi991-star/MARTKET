// Admin -> Manual Data Entry: hand-key a Forex Factory economic release or
// news/geopolitical event when Zapier hasn't (yet) delivered it — e.g.
// verifying the pipeline with real data before trusting the email/Zapier
// path, or entering something the email digest missed. Calls the exact
// same canonical ingestion functions as the Zapier webhook (see
// lib/actions/manual-data-entry.ts) — one pipeline, two entry points.
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { DataEntryClient } from "./DataEntryClient";

export const metadata = { title: "Manual Data Entry — Admin — Market Intelligence AI" };
export const dynamic = "force-dynamic";

export default async function DataEntryPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Manual Data Entry</h1>
          <p className="text-sm text-(--text-faint) mt-1">Hand-enter a Forex Factory economic release or news event — processed through the same pipeline as the Zapier webhook.</p>
        </div>
        <Link href="/admin" className="text-xs text-(--accent) hover:underline">
          ← Back to Admin
        </Link>
      </div>

      {isDemoOnly() ? (
        <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live and a database is connected.</p>
      ) : (
        <DataEntryClient />
      )}
    </div>
  );
}
