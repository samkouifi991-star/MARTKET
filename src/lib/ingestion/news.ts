// Canonical news/geopolitical-event ingestion — the ONE place that does
// validate→dedup→save→classify→affected-markets→recompute for an incoming
// news item, regardless of which channel produced it. Both the
// email/Zapier webhook and the Admin manual-entry Server Action call this
// exact function. Classification is grounding-only (classifyNewsWithLLM):
// the LLM classifies text that was actually supplied, it never invents an
// article.
import { NewsPayload } from "@/app/api/integrations/zapier/market-event/schema";
import { newsDedupKey } from "@/lib/normalization/dedup-key";
import { insertNewsArticleFromZapier, updateNewsArticleClassification } from "@/db/queries/market-data";
import { logZapierIngest } from "@/db/queries/zapier-ingest-log";
import { recordEventShock } from "@/db/queries/economic-releases";
import { classifyNewsWithLLM, LlmNewsClassification } from "@/lib/engines/llm-news-classifier";
import { classifyHeadline } from "@/lib/engines/news-classifier";
import { computeNewsShockContribution, mapRelevanceToTier } from "@/lib/scoring-v2/asset-interpretation/news-shock";
import { recomputeSymbols } from "@/lib/scoring-v2/recompute";
import { IngestChannel } from "./economic-event";

// Matches mapRelevanceToTier's MEDIUM floor — anything below never shocks a market score.
const HIGH_RELEVANCE_THRESHOLD = 40;

export type IngestNewsOptions = {
  channel: IngestChannel;
  dryRun: boolean;
  rawPayload: unknown;
};

export type IngestNewsResult =
  | { dryRun: true; wouldWrite: { dedupKey: string; headline: string; source: string; classification: unknown } }
  | { dryRun: false; duplicate: true }
  | { dryRun: false; duplicate: false; newsArticleId: number; recomputedMarkets: string[] };

export async function ingestNews(payload: NewsPayload, options: IngestNewsOptions): Promise<IngestNewsResult> {
  const dedupKey = payload.sourceUrl ?? newsDedupKey(payload.headline, payload.source, payload.publishedAt);

  if (options.dryRun) {
    let classification: (LlmNewsClassification & { model: string }) | null = null;
    let classifierError: string | null = null;
    try {
      classification = await classifyNewsWithLLM({ headline: payload.headline, summary: payload.summary, source: payload.source });
    } catch (err) {
      classifierError = err instanceof Error ? err.message : String(err);
    }
    return {
      dryRun: true,
      wouldWrite: {
        dedupKey,
        headline: payload.headline,
        source: payload.source,
        classification: classification ?? { fallback: classifyHeadline(payload.headline), classifierError },
      },
    };
  }

  const insertedId = await insertNewsArticleFromZapier({
    headline: payload.headline,
    source: payload.source,
    url: payload.sourceUrl ?? null,
    publishedAt: payload.publishedAt,
    dedupKey,
    provider: options.channel === "manual" ? "manual-admin" : "zapier-forexfactory",
  });

  if (insertedId === null) {
    await logZapierIngest({ payloadType: "news", channel: options.channel, rawPayload: options.rawPayload, dedupKey, outcome: "accepted_duplicate" }).catch(() => {});
    return { dryRun: false, duplicate: true };
  }

  let classification: LlmNewsClassification & { model: string | null };
  try {
    classification = await classifyNewsWithLLM({ headline: payload.headline, summary: payload.summary, source: payload.source });
  } catch {
    const fallback = classifyHeadline(payload.headline);
    classification = { ...fallback, affectedMarkets: [], geopoliticalRelevance: 0, monetaryPolicyRelevance: 0, riskSentiment: "Neutral", reason: "Keyword fallback — LLM classification unavailable.", model: null };
  }

  await updateNewsArticleClassification(insertedId, {
    affectedMarkets: classification.affectedMarkets,
    interpretation: classification.interpretation,
    importance: classification.importance,
    confidence: classification.confidence,
    reason: classification.reason,
    geopoliticalRelevance: classification.geopoliticalRelevance,
    monetaryPolicyRelevance: classification.monetaryPolicyRelevance,
    riskSentiment: classification.riskSentiment,
    classifierModel: classification.model,
  });

  let recomputedMarkets: string[] = [];
  const relevance = Math.max(classification.geopoliticalRelevance, classification.monetaryPolicyRelevance);
  if (relevance >= HIGH_RELEVANCE_THRESHOLD && classification.affectedMarkets.length > 0) {
    const contribution = computeNewsShockContribution(classification);
    if (contribution !== 0) {
      const tier = mapRelevanceToTier(classification);
      await Promise.all(classification.affectedMarkets.map((symbol) => recordEventShock({ symbol, factorKey: null, sourceReleaseId: null, initialContribution: contribution, importanceTier: tier })));
      recomputedMarkets = await recomputeSymbols(classification.affectedMarkets);
    }
  }

  await logZapierIngest({
    payloadType: "news",
    channel: options.channel,
    rawPayload: options.rawPayload,
    dedupKey,
    outcome: "accepted_new",
    newsArticleId: insertedId,
    recomputedMarkets,
  }).catch(() => {});

  return { dryRun: false, duplicate: false, newsArticleId: insertedId, recomputedMarkets };
}
