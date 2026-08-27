// Geopolitical Risk Tracker (Phase 8 of the platform redesign) — fed
// entirely by manual/Zapier-ingested news that has already been
// classified (geopoliticalRelevance/monetaryPolicyRelevance/riskCategory
// — see llm-news-classifier.ts). Never invents an event: every row here
// traces back to a real news_articles row that was actually submitted
// through the ingestion pipeline (manual or Zapier), classified from the
// text it was given.
//
// "Region" is derived, not stored: each event's affectedMarkets ->
// instrument.currencies -> CCY_TO_COUNTRY, the same country-code space
// every other economic surface in this app already uses — no new region
// taxonomy.
//
// The aggregate risk level and sub-scores are a pure, deterministic
// function: each qualifying article's relevance×importance is time-decayed
// using the exact same exponential half-life math event-shock.ts already
// uses for score shocks (decayedContribution), summed, then banded. This
// module's decay half-life and banding thresholds are this platform's own
// calibration (documented below), not a reused config from elsewhere,
// since nothing else in the codebase aggregates news this way yet.
import { INSTRUMENTS } from "@/lib/instruments";
import { CCY_TO_COUNTRY } from "@/lib/scoring";
import { getHighGeopoliticalRelevanceNews, StoredNewsArticle } from "@/db/queries/market-data";
import { decayedContribution } from "@/lib/scoring-v2/event-shock";

export type RiskCategory = "war" | "sanctions" | "tariffs" | "election" | "energy" | "central_bank" | "other";
export type GlobalRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type GeopoliticalEventRow = {
  id: number;
  headline: string;
  region: string;
  interpretation: string; // "Bullish" | "Bearish" | "Mixed" | "Neutral" | "Unclear"
  affectedMarkets: string[];
  riskCategory: string | null;
  confidence: number;
  publishedAt: string;
  ageHours: number;
};

export type GeopoliticalSubScores = { safeHaven: number; energy: number; tradeTariff: number; monetaryPolicy: number };

export type GeopoliticalRiskData = {
  level: GlobalRiskLevel;
  score: number;
  subScores: GeopoliticalSubScores;
  events: GeopoliticalEventRow[];
};

// A high-relevance news lookback and floor — matches the same
// HIGH_RELEVANCE_THRESHOLD the ingestion pipeline (news.ts) already uses
// to decide whether a headline is significant enough to shock a market
// score, so this tracker and the score-shock path agree on what counts
// as "high relevance."
const MIN_RELEVANCE = 40;
const MAX_EVENTS = 60;

// Geopolitical stories linger longer than a single economic release's
// same-day price reaction — a war/sanctions headline can keep moving
// safe-haven flows for the better part of a week, not hours. 96h (4 days)
// is this platform's own calibration for that longer decay, distinct from
// event-shock.ts's HIGH-tier economic-release half-life (which is much
// shorter, matching how quickly a single data print gets priced in).
const GEO_RISK_HALF_LIFE_HOURS = 96;

// This platform's own banding for the aggregate decayed-weight sum —
// thresholds chosen so a single major (importance 90+, relevance 90+)
// fresh headline alone (initial weight ~9) lands in HIGH, and two
// concurrent major stories reach CRITICAL.
const LEVEL_THRESHOLDS: { level: GlobalRiskLevel; min: number }[] = [
  { level: "CRITICAL", min: 18 },
  { level: "HIGH", min: 8 },
  { level: "MEDIUM", min: 3 },
  { level: "LOW", min: 0 },
];

function bandLevel(score: number): GlobalRiskLevel {
  return LEVEL_THRESHOLDS.find((t) => score >= t.min)!.level;
}

const CATEGORY_TO_SUBSCORE: Record<RiskCategory, keyof GeopoliticalSubScores | null> = {
  war: "safeHaven",
  sanctions: "safeHaven",
  election: "safeHaven",
  energy: "energy",
  tariffs: "tradeTariff",
  central_bank: "monetaryPolicy",
  other: null,
};

function isRiskCategory(value: string | null | undefined): value is RiskCategory {
  return value !== null && value !== undefined && value in CATEGORY_TO_SUBSCORE;
}

function deriveRegion(affectedMarkets: string[]): string {
  const countries = new Set<string>();
  for (const symbol of affectedMarkets) {
    const instrument = INSTRUMENTS.find((i) => i.symbol === symbol);
    if (!instrument?.currencies) continue;
    for (const ccy of instrument.currencies) {
      const country = CCY_TO_COUNTRY[ccy];
      if (country) countries.add(country);
    }
  }
  if (countries.size === 0) return "Global";
  if (countries.size === 1) return [...countries][0];
  return "Multi-region";
}

function initialWeightFor(article: StoredNewsArticle): number {
  const relevance = Math.max(article.geopoliticalRelevance ?? 0, article.monetaryPolicyRelevance ?? 0);
  // 0..10 base magnitude — the same "score-like" scale every other pure
  // math module in this codebase uses (see format.ts's -10..10 convention).
  return (relevance / 100) * (article.importance / 100) * 10;
}

function ageHoursOf(article: StoredNewsArticle, now: number): number {
  return Math.max(0, (now - new Date(article.publishedAt).getTime()) / 3_600_000);
}

export async function buildGeopoliticalRisk(now: Date = new Date()): Promise<GeopoliticalRiskData> {
  const articles = await getHighGeopoliticalRelevanceNews(MIN_RELEVANCE, MAX_EVENTS);
  const nowMs = now.getTime();

  const subScores: GeopoliticalSubScores = { safeHaven: 0, energy: 0, tradeTariff: 0, monetaryPolicy: 0 };
  let totalScore = 0;

  const events: GeopoliticalEventRow[] = articles.map((article) => {
    const ageHours = ageHoursOf(article, nowMs);
    const decayed = decayedContribution(initialWeightFor(article), ageHours, GEO_RISK_HALF_LIFE_HOURS);
    totalScore += decayed;

    if (isRiskCategory(article.riskCategory)) {
      const bucket = CATEGORY_TO_SUBSCORE[article.riskCategory];
      if (bucket) subScores[bucket] += decayed;
    }

    return {
      id: article.id,
      headline: article.headline,
      region: deriveRegion(article.affectedMarkets),
      interpretation: article.interpretation,
      affectedMarkets: article.affectedMarkets,
      riskCategory: article.riskCategory ?? null,
      confidence: article.confidence,
      publishedAt: article.publishedAt,
      ageHours: Number(ageHours.toFixed(1)),
    };
  });

  return {
    level: bandLevel(totalScore),
    score: Number(totalScore.toFixed(2)),
    subScores: {
      safeHaven: Number(subScores.safeHaven.toFixed(2)),
      energy: Number(subScores.energy.toFixed(2)),
      tradeTariff: Number(subScores.tradeTariff.toFixed(2)),
      monetaryPolicy: Number(subScores.monetaryPolicy.toFixed(2)),
    },
    events,
  };
}
