// News classifier — v1 keyword heuristic, not NLP/LLM. Deliberately caps
// confidence well below what a real classifier would earn, since a keyword
// match is much weaker evidence than an actual read of the article.
// Upgrading to an LLM-based classifier (topic, directional impact,
// confidence) is the clear next step for the News Intelligence module.
const BULLISH_TERMS = ["rally", "surge", "beats", "beat expectations", "strengthens", "gains", "optimism", "hawkish", "outperform", "record high", "upgrade", "rebound", "rises", "climbs"];
const BEARISH_TERMS = ["falls", "drops", "misses", "miss expectations", "weakens", "losses", "concern", "dovish", "underperform", "record low", "downgrade", "selloff", "slumps", "plunges"];
const HIGH_IMPORTANCE_TERMS = ["fed", "federal reserve", "ecb", "central bank", "rate decision", "inflation", "cpi", "nonfarm payrolls", "gdp", "war", "geopolitical", "crisis"];

export type NewsClassification = {
  interpretation: "Bullish" | "Bearish" | "Mixed" | "Neutral";
  importance: number;
  confidence: number;
};

export function classifyHeadline(headline: string): NewsClassification {
  const lower = headline.toLowerCase();
  const bullishHits = BULLISH_TERMS.filter((t) => lower.includes(t)).length;
  const bearishHits = BEARISH_TERMS.filter((t) => lower.includes(t)).length;
  const importantHits = HIGH_IMPORTANCE_TERMS.filter((t) => lower.includes(t)).length;

  let interpretation: NewsClassification["interpretation"] = "Neutral";
  if (bullishHits > 0 && bearishHits === 0) interpretation = "Bullish";
  else if (bearishHits > 0 && bullishHits === 0) interpretation = "Bearish";
  else if (bullishHits > 0 && bearishHits > 0) interpretation = "Mixed";

  const importance = Math.min(90, 30 + importantHits * 20 + (bullishHits + bearishHits) * 8);
  const confidence = Math.min(55, 20 + (bullishHits + bearishHits) * 10);

  return { interpretation, importance, confidence };
}

export function articleMentionsInstrument(haystackText: string, symbolOrSymbols: string[], symbol: string, currencies: [string, string] | undefined): boolean {
  const haystack = (haystackText + " " + symbolOrSymbols.join(" ")).toLowerCase();
  if (haystack.includes(symbol.toLowerCase())) return true;
  if (currencies) return currencies.some((c) => haystack.includes(c.toLowerCase()));
  return false;
}
