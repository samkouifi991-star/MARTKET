// Live-aware general news feed — Phase 18 (public-launch demo sweep): the
// Dashboard's "High-importance news" card and the /news page called the
// hand-seeded NEWS_ARTICLES demo array unconditionally, regardless of
// DATA_MODE. This reads the SAME newsArticles rows cron/news's
// insertNewsArticle already writes (real FMP articles run through the v1
// keyword classifier — see lib/engines/news-classifier.ts), storage-first,
// no live provider call at render time.
//
// Deliberately a leaner shape than the demo NewsArticle type: urgency,
// isPriced, expectedImpactDuration, and topic have no honest real-data
// equivalent (the v1 keyword classifier never produces them, and there's no
// other real signal for them), so they're omitted here rather than
// invented. NewsClient (components/news article renderer) treats them as
// optional and simply doesn't render what isn't present.
import { getRecentNews } from "@/db/queries/market-data";
import { INSTRUMENTS } from "@/lib/instruments";
import { ClientNewsArticle } from "@/lib/types";

const KNOWN_SYMBOLS = new Set(INSTRUMENTS.map((i) => i.symbol));

export async function getLiveNewsFeed(limit = 60): Promise<ClientNewsArticle[]> {
  const rows = await getRecentNews(limit);
  return rows.map((r) => ({
    id: String(r.id),
    headline: r.headline,
    source: r.source,
    publishedAt: r.publishedAt,
    // Only keep tags that are actually one of our tracked instruments — the
    // stored value is FMP's own raw ticker, not guaranteed to match our
    // internal symbol format, so an unrecognized one is dropped rather than
    // rendered as a link to a page that doesn't exist.
    affectedMarkets: r.affectedMarkets.filter((m) => KNOWN_SYMBOLS.has(m)),
    interpretation: r.interpretation as ClientNewsArticle["interpretation"],
    importance: r.importance,
    confidence: r.confidence,
    explanation: r.reason,
    geopoliticalRelevance: r.geopoliticalRelevance ?? undefined,
    monetaryPolicyRelevance: r.monetaryPolicyRelevance ?? undefined,
    riskSentiment: r.riskSentiment ?? undefined,
  }));
}
