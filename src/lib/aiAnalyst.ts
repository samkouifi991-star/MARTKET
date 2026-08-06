import { INSTRUMENTS, getInstrument } from "./instruments";
import { allMarketRows } from "./market-data";
import { factorLabel } from "./scoring";
import { generatePositioning } from "./demo/positioning";
import { generateSmartMoney } from "./demo/smartMoney";
import { CALENDAR_EVENTS } from "./demo/calendar";
import { getEconomy } from "./demo/economies";
import { formatDateTime } from "./time";

export type AiAnswer = { text: string; citations: string[] };

const ALIASES: Record<string, string> = {
  nasdaq: "NAS100",
  dow: "DJ30",
  "s&p": "SPX500",
  sp500: "SPX500",
  "s&p 500": "SPX500",
  oil: "WTIUSD",
  crude: "WTIUSD",
  btc: "BTCUSD",
  bitcoin: "BTCUSD",
  eth: "ETHUSD",
  ethereum: "ETHUSD",
  gold: "XAUUSD",
  silver: "XAGUSD",
  nikkei: "NIKKEI225",
  ftse: "FTSE100",
  dax: "DAX40",
  russell: "RUT2000",
  euro: "EURUSD",
};

function findInstrumentInQuery(q: string) {
  const lower = q.toLowerCase();
  for (const [alias, symbol] of Object.entries(ALIASES)) {
    if (lower.includes(alias)) return getInstrument(symbol);
  }
  return INSTRUMENTS.find((i) => {
    if (lower.includes(i.symbol.toLowerCase())) return true;
    const nameWords = i.name.toLowerCase().split(/\s+/);
    return nameWords.some((w) => w.length > 3 && lower.includes(w));
  });
}

function explainMarket(symbol: string): AiAnswer {
  const instrument = getInstrument(symbol)!;
  const row = allMarketRows().find((r) => r.instrument.symbol === symbol)!;
  const top = [...row.score.factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3);
  const text = `${instrument.symbol} (${instrument.name}) has a total score of ${row.score.totalScore > 0 ? "+" : ""}${row.score.totalScore.toFixed(1)}, classified as ${row.score.bias}, with ${row.score.confidence}% confidence. The largest contributors are ${top
    .map((f) => `${factorLabel(f.key)} (${f.contribution > 0 ? "+" : ""}${f.contribution.toFixed(1)}: ${f.explanation}`)
    .join(") · ")}). 24h score change: ${row.score.change24h > 0 ? "+" : ""}${row.score.change24h.toFixed(1)}.`;
  return { text, citations: top.map((f) => `${instrument.symbol} · ${factorLabel(f.key)} factor`) };
}

function whatChanged(symbol: string): AiAnswer {
  const instrument = getInstrument(symbol)!;
  const row = allMarketRows().find((r) => r.instrument.symbol === symbol)!;
  const h = row.score.history;
  const weekAgo = h[Math.max(0, h.length - 8)].score;
  const now = h[h.length - 1].score;
  const drivers = [...row.score.factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 2);
  const text = `${instrument.symbol}'s total score moved from ${weekAgo > 0 ? "+" : ""}${weekAgo.toFixed(1)} a week ago to ${now > 0 ? "+" : ""}${now.toFixed(1)} today (${row.score.bias}). The factors currently carrying the most weight are ${factorLabel(drivers[0].key)} (${drivers[0].contribution > 0 ? "+" : ""}${drivers[0].contribution.toFixed(1)}) and ${factorLabel(drivers[1].key)} (${drivers[1].contribution > 0 ? "+" : ""}${drivers[1].contribution.toFixed(1)}). ${drivers[0].explanation}`;
  return { text, citations: [`${instrument.symbol} · 30-day score history`, `${instrument.symbol} · ${factorLabel(drivers[0].key)} factor`] };
}

function strongestInstitutionalBuying(): AiAnswer {
  const rows = INSTRUMENTS.map((i) => ({ i, pos: generatePositioning(i) })).sort((a, b) => b.pos.netWeeklyChange - a.pos.netWeeklyChange).slice(0, 5);
  const text = `The strongest institutional buying (largest positive weekly net-positioning change) is currently in: ${rows
    .map((r) => `${r.i.symbol} (${r.pos.netWeeklyChange > 0 ? "+" : ""}${r.pos.netWeeklyChange.toLocaleString()} contracts)`)
    .join(", ")}.`;
  return { text, citations: rows.map((r) => `${r.i.symbol} · Institutional Positioning module`) };
}

function divergenceMarkets(): AiAnswer {
  const rows = INSTRUMENTS.map((i) => generateSmartMoney(i)).filter((s) => s.signal !== "None");
  if (rows.length === 0) {
    return { text: "No markets currently show a notable institutional/retail divergence.", citations: ["Smart Money module"] };
  }
  const text = `Markets currently showing institutional/retail disagreement: ${rows.map((r) => `${r.symbol} (${r.signal}, ${r.confidence}% confidence)`).join("; ")}.`;
  return { text, citations: rows.map((r) => `${r.symbol} · Smart Money Divergence`) };
}

function eventsAffecting(symbol: string): AiAnswer {
  const instrument = getInstrument(symbol)!;
  const tickers = instrument.currencies ?? [instrument.symbol];
  const now = Date.now();
  const events = CALENDAR_EVENTS.filter((e) => !e.actual && new Date(e.dateTime).getTime() > now && e.affectedMarkets.some((m) => tickers.includes(m))).slice(0, 4);
  if (events.length === 0) {
    return { text: `No scheduled high-impact releases are currently tagged to ${instrument.symbol} in the near term.`, citations: ["Economic Calendar module"] };
  }
  const text = `Upcoming releases that could affect ${instrument.symbol}: ${events.map((e) => `${e.event} (${e.country}, ${formatDateTime(e.dateTime)})`).join("; ")}.`;
  return { text, citations: events.map((e) => `Economic Calendar · ${e.event}`) };
}

function compareMarkets(a: string, b: string): AiAnswer {
  const rowA = allMarketRows().find((r) => r.instrument.symbol === a)!;
  const rowB = allMarketRows().find((r) => r.instrument.symbol === b)!;
  const text = `${a}: ${rowA.score.totalScore > 0 ? "+" : ""}${rowA.score.totalScore.toFixed(1)} (${rowA.score.bias}, ${rowA.score.confidence}% confidence). ${b}: ${rowB.score.totalScore > 0 ? "+" : ""}${rowB.score.totalScore.toFixed(1)} (${rowB.score.bias}, ${rowB.score.confidence}% confidence). Institutional positioning: ${a} ${rowA.score.factors.find((f) => f.key === "institutional")!.contribution.toFixed(1)} vs. ${b} ${rowB.score.factors.find((f) => f.key === "institutional")!.contribution.toFixed(1)}. Technical trend: ${a} ${rowA.score.factors.find((f) => f.key === "technical")!.contribution.toFixed(1)} vs. ${b} ${rowB.score.factors.find((f) => f.key === "technical")!.contribution.toFixed(1)}.`;
  return { text, citations: [`${a} · full score breakdown`, `${b} · full score breakdown`] };
}

function weakeningDollar(): AiAnswer {
  const usEco = getEconomy("US");
  const usdRows = allMarketRows().filter((r) => r.instrument.currencies?.includes("USD"));
  const usdWeighted = usdRows
    .map((r) => {
      const isBaseUsd = r.instrument.currencies![0] === "USD";
      const directional = isBaseUsd ? -r.score.totalScore : r.score.totalScore; // positive = USD weaker
      return { symbol: r.instrument.symbol, directional };
    })
    .sort((a, b) => b.directional - a.directional)
    .slice(0, 3);
  const text = `Factors currently weighing on the dollar: US growth surprise score is ${usEco.growthScore > 0 ? "+" : ""}${usEco.growthScore.toFixed(1)} and inflation is trending ${usEco.inflationTrend.toLowerCase()}. The pairs showing the most USD weakness in their total score are ${usdWeighted.map((r) => r.symbol).join(", ")}. Check the Interest Rates module for the latest Fed stance, which is the single largest USD-relevant factor.`;
  return { text, citations: ["Economic Growth · United States", "Inflation · United States", ...usdWeighted.map((r) => `${r.symbol} · score breakdown`)] };
}

function highestConfidence(): AiAnswer {
  const rows = [...allMarketRows()].sort((a, b) => b.score.confidence - a.score.confidence).slice(0, 5);
  const text = `Highest-confidence scores right now: ${rows.map((r) => `${r.instrument.symbol} (${r.score.confidence}%, ${r.score.bias})`).join(", ")}.`;
  return { text, citations: rows.map((r) => `${r.instrument.symbol} · confidence score`) };
}

export function answerQuestion(query: string): AiAnswer {
  const q = query.toLowerCase();
  const instrument = findInstrumentInQuery(query);

  if (/institutional buying|institutional.*strongest/.test(q)) return strongestInstitutionalBuying();
  if (/disagree|divergence|retail and institutional/.test(q)) return divergenceMarkets();
  if (/highest confidence/.test(q)) return highestConfidence();
  if (/weaken(ing)? (the )?(us )?dollar|dollar weakness/.test(q)) return weakeningDollar();
  if (/compare/.test(q)) {
    const symbols = new Set<string>();
    for (const [alias, symbol] of Object.entries(ALIASES)) if (q.includes(alias)) symbols.add(symbol);
    for (const i of INSTRUMENTS) if (q.includes(i.symbol.toLowerCase())) symbols.add(i.symbol);
    const matches = Array.from(symbols);
    if (matches.length >= 2) return compareMarkets(matches[0], matches[1]);
  }
  if (/economic (release|event)|what.*affect/.test(q) && instrument) return eventsAffecting(instrument.symbol);
  if (/what changed/.test(q) && instrument) return whatChanged(instrument.symbol);
  if (/why is|why.*bullish|why.*bearish/.test(q) && instrument) return explainMarket(instrument.symbol);
  if (instrument) return explainMarket(instrument.symbol);

  return {
    text: "I can only answer using data already on the platform, and I won't guess when the data doesn't cover a question. Try asking about a specific market (e.g. \"Why is gold bullish today?\"), institutional/retail divergence, upcoming economic releases, or a comparison between two markets.",
    citations: [],
  };
}

export const SAMPLE_QUESTIONS = [
  "Why is gold bullish today?",
  "What changed in EUR/USD?",
  "Which markets have the strongest institutional buying?",
  "Show markets where retail and institutional traders disagree.",
  "What economic releases could affect the NASDAQ today?",
  "Compare Bitcoin and gold.",
  "What factors are weakening the US dollar?",
  "Which current score has the highest confidence?",
];
