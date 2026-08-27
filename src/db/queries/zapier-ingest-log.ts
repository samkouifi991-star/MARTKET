// Full audit trail of every inbound Zapier call (accepted, duplicate,
// rejected, or errored) — never the source of truth for economic_events/
// newsArticles themselves, purely provenance for the Admin "Incoming
// Data" page (requirement: "see exactly what Zapier is sending").
import { desc, sql } from "drizzle-orm";
import { getDb } from "../client";
import { zapierIngestLog } from "../schema";

export type ZapierIngestOutcome =
  | "accepted_new"
  | "accepted_duplicate"
  | "accepted_revision"
  | "accepted_unclassified"
  | "rejected_invalid_payload"
  | "rejected_unauthorized"
  | "rejected_rate_limited"
  | "dry_run"
  | "error";

export async function logZapierIngest(entry: {
  payloadType: "economic_event" | "news" | "unknown";
  rawPayload: unknown;
  dedupKey: string | null;
  outcome: ZapierIngestOutcome;
  economicEventId?: number | null;
  newsArticleId?: number | null;
  recomputedMarkets?: string[];
  errorDetail?: string | null;
}): Promise<void> {
  const db = getDb();
  await db.insert(zapierIngestLog).values({
    payloadType: entry.payloadType,
    rawPayload: entry.rawPayload as object,
    dedupKey: entry.dedupKey,
    outcome: entry.outcome,
    economicEventId: entry.economicEventId ?? null,
    newsArticleId: entry.newsArticleId ?? null,
    recomputedMarkets: entry.recomputedMarkets ?? [],
    errorDetail: entry.errorDetail ?? null,
  });
}

export type ZapierIngestLogRow = {
  id: number;
  receivedAt: string;
  payloadType: string;
  outcome: string;
  dedupKey: string | null;
  economicEventId: number | null;
  newsArticleId: number | null;
  recomputedMarkets: string[];
  errorDetail: string | null;
  // The exact body Zapier sent — the Admin Incoming Data page reads
  // event/headline/currency/impact straight from this rather than
  // joining economic_events/news_articles, since the log already carries
  // everything those columns would show.
  rawPayload: unknown;
};

export async function getRecentZapierIngestLog(limit = 100): Promise<ZapierIngestLogRow[]> {
  const db = getDb();
  const rows = await db.select().from(zapierIngestLog).orderBy(desc(zapierIngestLog.receivedAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    receivedAt: r.receivedAt.toISOString(),
    payloadType: r.payloadType,
    outcome: r.outcome,
    dedupKey: r.dedupKey,
    economicEventId: r.economicEventId,
    newsArticleId: r.newsArticleId,
    recomputedMarkets: r.recomputedMarkets,
    errorDetail: r.errorDetail,
    rawPayload: r.rawPayload,
  }));
}

export async function getZapierIngestOutcomeCounts(lookbackDays = 7): Promise<Record<string, number>> {
  const db = getDb();
  const cutoff = new Date(Date.now() - lookbackDays * 86_400_000);
  const rows = await db
    .select({ outcome: zapierIngestLog.outcome, count: sql<number>`count(*)::int` })
    .from(zapierIngestLog)
    .where(sql`${zapierIngestLog.receivedAt} > ${cutoff}`)
    .groupBy(zapierIngestLog.outcome);
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.outcome] = row.count;
  return counts;
}
