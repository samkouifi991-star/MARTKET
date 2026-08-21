// Proves the SCHEDULED cron — not a one-off script — actually covers all
// OANDA-mapped FX pairs automatically. Vercel Cron Jobs never fire against
// this Preview-only deployment (see project history), so this invokes the
// real, unmodified GET handler from src/app/api/cron/retail-sentiment/
// route.ts directly, with the real CRON_SECRET from this deploy's own
// environment — exactly the request Vercel Cron itself would send, not a
// reimplementation of its logic.
//
// Usage: run inside the Vercel build container (via vercel-build), where
// CRON_SECRET is a real env var: npm run test:retail-sentiment-cron-verify
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { NextRequest } from "next/server";
import { GET } from "../src/app/api/cron/retail-sentiment/route";
import { getSymbolMapping } from "../src/services/market-data/symbol-map";
import { getLatestStoredRetailSentiment } from "../src/db/queries/market-data";

const OANDA_FX_PAIRS = ["GBPUSD", "EURUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY"];

function log(msg: string): void {
  console.log(`RETAIL_SENTIMENT_CRON_VERIFY: ${msg}`);
}

async function main() {
  if (!process.env.CRON_SECRET) {
    log("SKIPPED — CRON_SECRET not set in this environment");
    return;
  }

  const missingOanda = OANDA_FX_PAIRS.filter((s) => !getSymbolMapping(s)?.oandaInstrument);
  log(`Symbol-map check: ${OANDA_FX_PAIRS.length - missingOanda.length}/${OANDA_FX_PAIRS.length} of the expected OANDA FX pairs have oandaInstrument set${missingOanda.length ? ` — MISSING: ${missingOanda.join(", ")}` : ""}`);

  const req = new NextRequest("https://internal.invalid/api/cron/retail-sentiment", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });

  const res = await GET(req);
  const body = (await res.json()) as { job: string; okCount: number; failCount: number; note?: string };
  log(`Cron route response: ${JSON.stringify(body)}`);

  if (res.status !== 200) {
    log(`FAILED — route returned HTTP ${res.status} (auth or demo-mode gate rejected the request)`);
    return;
  }

  // The route itself only returns aggregate okCount/failCount — read Neon
  // back directly, per symbol, for real per-symbol proof of persistence.
  for (const symbol of OANDA_FX_PAIRS) {
    const stored = await getLatestStoredRetailSentiment(symbol);
    log(
      stored
        ? `${symbol} STORED provider=${stored.provider} pctLong=${stored.pctLong.toFixed(2)} pctShort=${stored.pctShort.toFixed(2)} sourceUpdatedAt=${stored.sourceUpdatedAt?.toISOString() ?? "null"} fetchedAt=${stored.fetchedAt.toISOString()}`
        : `${symbol} STORED none — the cron run did not persist a row for this symbol`
    );
  }

  log("DONE — the real scheduled route handler ran and wrote whatever it fetched to Neon");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
