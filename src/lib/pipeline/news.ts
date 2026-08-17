// News factor resolver — v1 classifier. This is a documented, honest
// keyword-based heuristic, not an NLP/LLM classifier: it looks for
// bullish/bearish/high-importance language in the headline and scores
// accordingly, capping confidence well below what a real classifier would
// earn. Upgrading this to an LLM-based classifier (topic, directional
// impact, confidence) is the clear next step for section 9 of the spec;
// this exists so the News factor is never a fabricated/demo value once
// FMP_API_KEY is configured, even before that upgrade lands.
import { getInstrument } from "@/lib/instruments";
import { newsFactor as demoNewsFactor } from "@/lib/scoring";
import * as fmp from "@/services/market-data/fmp";
import { NormalizedNewsArticle } from "@/services/types";
import { demoFallbackFactor, errorFactor, ResolvedFactor, unavailableFactor } from "./types";
import { DataMode } from "@/services/data-mode";

const SOURCE = "FMP forex/stock news (keyword classifier v1)";

const BULLISH_TERMS = ["rally", "surge", "beats", "beat expectations", "strengthens", "gains", "optimism", "hawkish", "outperform", "record high", "upgrade", "rebound", "rises", "climbs"];
const BEARISH_TERMS = ["falls", "drops", "misses", "miss expectations", "weakens", "losses", "concern", "dovish", "underperform", "record low", "downgrade", "selloff", "slumps", "plunges"];
const HIGH_IMPORTANCE_TERMS = ["fed", "federal reserve", "ecb", "central bank", "rate decision", "inflation", "cpi", "nonfarm payrolls", "gdp", "war", "geopolitical", "crisis"];

function classify(headline: string): { interpretation: "Bullish" | "Bearish" | "Mixed" | "Neutral"; importance: number; confidence: number } {
  const lower = headline.toLowerCase();
  const bullishHits = BULLISH_TERMS.filter((t) => lower.includes(t)).length;
  const bearishHits = BEARISH_TERMS.filter((t) => lower.includes(t)).length;
  const importantHits = HIGH_IMPORTANCE_TERMS.filter((t) => lower.includes(t)).length;

  let interpretation: "Bullish" | "Bearish" | "Mixed" | "Neutral" = "Neutral";
  if (bullishHits > 0 && bearishHits === 0) interpretation = "Bullish";
  else if (bearishHits > 0 && bullishHits === 0) interpretation = "Bearish";
  else if (bullishHits > 0 && bearishHits > 0) interpretation = "Mixed";

  const importance = Math.min(90, 30 + importantHits * 20 + (bullishHits + bearishHits) * 8);
  // Deliberately capped — a keyword match is weaker evidence than a real
  // NLP/LLM read of the full article, so this must never claim high confidence.
  const confidence = Math.min(55, 20 + (bullishHits + bearishHits) * 10);

  return { interpretation, importance, confidence };
}

function articleMentionsInstrument(article: NormalizedNewsArticle, symbol: string, currencies: [string, string] | undefined): boolean {
  const haystack = (article.headline + " " + article.symbols.join(" ")).toLowerCase();
  if (haystack.includes(symbol.toLowerCase())) return true;
  if (currencies) return currencies.some((c) => haystack.includes(c.toLowerCase()));
  return false;
}

export async function resolveNewsFactor(symbol: string, mode: DataMode): Promise<ResolvedFactor> {
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor("news", SOURCE, `Unknown instrument ${symbol}`);

  const news = await fmp.getForexAndMarketNews(100);
  if (news.status !== "live" || !news.value) {
    if (mode === "hybrid") {
      const fallback = demoNewsFactor(instrument);
      return demoFallbackFactor({ key: "news", rawScore: fallback.raw, explanation: fallback.explanation, source: "News Intelligence engine (demo)", lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
    }
    return news.status === "error" ? errorFactor("news", SOURCE, news.error ?? "request failed") : unavailableFactor("news", SOURCE, "FMP news feed unavailable");
  }

  const related = news.value.filter((a) => articleMentionsInstrument(a, symbol, instrument.currencies));
  if (related.length === 0) {
    return {
      key: "news",
      rawScore: 0,
      explanation: "No significant recent news flow tagged to this market.",
      source: SOURCE,
      provider: "fmp",
      freshness: "live",
      lastUpdated: new Date().toISOString(),
      nextUpdate: new Date().toISOString(),
    };
  }

  const classified = related.map((a) => ({ article: a, ...classify(a.headline) }));
  const signMap: Record<string, number> = { Bullish: 1, Bearish: -1, Mixed: 0, Neutral: 0 };
  let weightedSum = 0;
  let weightTotal = 0;
  for (const c of classified) {
    const w = (c.importance / 100) * (c.confidence / 100);
    weightedSum += signMap[c.interpretation] * w;
    weightTotal += w;
  }
  const rawScore = Math.max(-10, Math.min(10, weightTotal > 0 ? (weightedSum / weightTotal) * 10 : 0));
  const top = [...classified].sort((a, b) => b.importance - a.importance)[0];

  return {
    key: "news",
    rawScore,
    explanation: `${related.length} recent stor${related.length === 1 ? "y" : "ies"} tagged to this market. Most significant: "${top.article.headline}" (${top.interpretation}, importance ${top.importance}/100, confidence ${top.confidence}/100 — v1 keyword classifier).`,
    source: SOURCE,
    provider: "fmp",
    freshness: "live",
    lastUpdated: news.sourceUpdatedAt ?? new Date().toISOString(),
    nextUpdate: new Date().toISOString(),
  };
}
