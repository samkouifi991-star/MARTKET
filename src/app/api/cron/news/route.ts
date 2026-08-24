// News — as frequently as provider limits allow. Classifies and stores
// every article via the same v1 keyword engine the scoring pipeline uses,
// so what's stored matches what factor explanations cite.
import { NextRequest, NextResponse } from "next/server";
import * as fmp from "@/services/market-data/fmp";
import { classifyHeadline } from "@/lib/engines/news-classifier";
import { insertNewsArticle } from "@/db/queries/market-data";
import { recordProviderCheck } from "@/db/queries/provider-health";
import { demoModeSkip, isDemoMode, unauthorized, verifyCronAuth } from "../_shared";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const t0 = Date.now();
  const news = await fmp.getForexAndMarketNews(100);
  if (news.status !== "live" || !news.value) {
    await recordProviderCheck({ provider: "fmp:news", ok: false, latencyMs: Date.now() - t0, error: news.error ?? "news unavailable" }).catch(() => {});
    return NextResponse.json({ job: "news", okCount: 0, failCount: 1, error: news.error }, { status: 502 });
  }

  for (const article of news.value) {
    const classification = classifyHeadline(article.headline);
    await insertNewsArticle(article, {
      interpretation: classification.interpretation,
      importance: classification.importance,
      confidence: classification.confidence,
      reason: `v1 keyword classifier: ${classification.interpretation} (importance ${classification.importance}/100, confidence ${classification.confidence}/100)`,
    });
  }
  await recordProviderCheck({ provider: "fmp:news", ok: true, latencyMs: Date.now() - t0 }).catch(() => {});

  return NextResponse.json({ job: "news", okCount: news.value.length, failCount: 0 });
}
