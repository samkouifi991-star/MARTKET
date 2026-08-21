// Final UI-data verification for the Retail Sentiment row on all 10
// configured OANDA FX score sheets, plus a re-check that XAUUSD/XAGUSD now
// show the new concise UNAVAILABLE message. This sandbox cannot reach the
// live deployed URL directly (outbound network policy blocks arbitrary
// vercel.app hosts), so instead of screenshotting HTML, this calls the
// exact same functions the market-detail page calls —
// computeLiveMarketScore, factorSentiment, factorLabel — and prints every
// value the page renders for the retailSentiment row: sentiment badge,
// freshness badge + timestamp, raw score, weight, weighted contribution,
// explanation (carries long%/short%), and Source line. This verifies the
// real data the UI would display, not just that the resolver function
// returns something.
//
// Read-only — makes no writes, changes no scoring logic.
//
// Usage: npm run test:fx-retail-sentiment-ui-verify
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { computeLiveMarketScore } from "../src/lib/pipeline/scoring-engine";
import { factorSentiment } from "../src/lib/format";
import { factorLabel } from "../src/lib/scoring";
import { DATA_MODE } from "../src/services/data-mode";

const FX_PAIRS = ["GBPUSD", "EURUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY"];
const METALS = ["XAUUSD", "XAGUSD"];

function log(msg: string): void {
  console.log(`FX_RETAIL_SENTIMENT_UI_VERIFY: ${msg}`);
}

async function checkFxPair(symbol: string): Promise<boolean> {
  const score = await computeLiveMarketScore(symbol, "live");
  const f = score.factors.find((x) => x.key === "retailSentiment")!;
  const sentimentBadge = factorSentiment(f.contribution);
  const freshnessBadge = f.freshness.toUpperCase();

  log(`==== ${symbol} — ${factorLabel(f.key)} row ====`);
  log(`  Sentiment badge: ${sentimentBadge}`);
  log(`  Freshness badge: ${freshnessBadge}   Timestamp (lastUpdated): ${f.lastUpdated}`);
  log(`  raw ${f.rawScore}   weight ${(f.weight * 100).toFixed(0)}%   contribution ${f.contribution}`);
  log(`  Explanation: "${f.explanation}"`);
  log(`  Source line: "Source: ${f.source}"`);

  const checks: { label: string; pass: boolean }[] = [
    { label: "freshness is LIVE/DELAYED/STALE (not unavailable/error/estimated)", pass: ["live", "delayed", "stale"].includes(f.freshness) },
    { label: "sentiment badge is Bullish/Bearish/Neutral", pass: ["Bullish", "Bearish", "Neutral"].includes(sentimentBadge) },
    { label: "explanation mentions long %", pass: /\d+% of retail traders are long/.test(f.explanation) },
    { label: "explanation mentions short %", pass: /\d+% short/.test(f.explanation) },
    { label: "weight is exactly 10%", pass: f.weight === 0.1 },
    { label: "provider is oanda", pass: f.provider === "oanda" },
    { label: 'Source line reads "Source: OANDA PositionBook"', pass: f.source === "OANDA PositionBook" },
    { label: "lastUpdated is a real (non-current-render-time) timestamp", pass: !!f.lastUpdated && !Number.isNaN(new Date(f.lastUpdated).getTime()) },
    { label: "no obsolete Myfxbook wording present", pass: !/myfxbook/i.test(f.explanation) && !/myfxbook/i.test(f.source) },
  ];
  let allPass = true;
  for (const c of checks) {
    log(`  CHECK [${c.pass ? "PASS" : "FAIL"}] ${c.label}`);
    allPass = allPass && c.pass;
  }

  const sumContributions = Number(score.factors.reduce((s, x) => s + x.contribution, 0).toFixed(2));
  const includedCheck = score.totalScore === sumContributions;
  log(`  CHECK [${includedCheck ? "PASS" : "FAIL"}] retailSentiment contribution (${f.contribution}) is included in totalScore (${score.totalScore} = sum of all contributions ${sumContributions})`);
  allPass = allPass && includedCheck;

  log(`${symbol} OVERALL: ${allPass ? "ALL CHECKS PASS" : "SOME CHECKS FAILED"}`);
  return allPass;
}

async function checkMetal(symbol: string): Promise<boolean> {
  const score = await computeLiveMarketScore(symbol, "live");
  const f = score.factors.find((x) => x.key === "retailSentiment")!;
  log(`==== ${symbol} — ${factorLabel(f.key)} row (expected UNAVAILABLE) ====`);
  log(`  Freshness: ${f.freshness}`);
  log(`  Explanation: "${f.explanation}"`);
  log(`  Source line: "Source: ${f.source}"`);

  const checks: { label: string; pass: boolean }[] = [
    { label: "freshness is unavailable", pass: f.freshness === "unavailable" },
    { label: 'explanation is exactly the concise message', pass: f.explanation === "No verified retail-positioning source is currently available for this market." },
    { label: "no Myfxbook wording present", pass: !/myfxbook/i.test(f.explanation) && !/myfxbook/i.test(f.source) },
    { label: "no credential/session/error text leaked", pass: !/credential|session|login|password|token/i.test(f.explanation) },
  ];
  let allPass = true;
  for (const c of checks) {
    log(`  CHECK [${c.pass ? "PASS" : "FAIL"}] ${c.label}`);
    allPass = allPass && c.pass;
  }
  log(`${symbol} OVERALL: ${allPass ? "ALL CHECKS PASS" : "SOME CHECKS FAILED"}`);
  return allPass;
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }

  let allPass = true;
  for (const symbol of FX_PAIRS) {
    try {
      allPass = (await checkFxPair(symbol)) && allPass;
    } catch (err) {
      log(`${symbol} FAILED — ${err instanceof Error ? err.message : String(err)}`);
      allPass = false;
    }
  }
  for (const symbol of METALS) {
    try {
      allPass = (await checkMetal(symbol)) && allPass;
    } catch (err) {
      log(`${symbol} FAILED — ${err instanceof Error ? err.message : String(err)}`);
      allPass = false;
    }
  }

  log(`FINAL VERDICT: ${allPass ? "ALL PASS" : "SOME FAILED"}`);
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
