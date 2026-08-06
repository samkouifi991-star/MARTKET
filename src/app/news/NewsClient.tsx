"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { NewsArticle } from "@/lib/types";
import { formatRelative } from "@/lib/time";

const IMPACT_CLASSES: Record<NewsArticle["interpretation"], string> = {
  Bullish: "text-emerald-400 bg-emerald-500/10",
  Bearish: "text-rose-400 bg-rose-500/10",
  Mixed: "text-amber-400 bg-amber-500/10",
  Neutral: "text-slate-300 bg-slate-500/10",
  Unclear: "text-sky-400 bg-sky-500/10",
};

export function NewsClient({ articles }: { articles: NewsArticle[] }) {
  const [topic, setTopic] = useState<string>("All");
  const topics = useMemo(() => ["All", ...Array.from(new Set(articles.map((a) => a.topic)))], [articles]);
  const filtered = topic === "All" ? articles : articles.filter((a) => a.topic === topic);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border border-(--border) p-1 w-fit">
        {topics.map((t) => (
          <button
            key={t}
            onClick={() => setTopic(t)}
            className={`h-8 px-3 rounded-md text-xs transition-colors ${topic === t ? "bg-(--accent-soft) text-(--accent)" : "text-(--text-faint) hover:text-(--text-dim)"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((n) => (
          <div key={n.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-medium text-sm leading-snug max-w-2xl">{n.headline}</h3>
              <span className={`shrink-0 text-[11px] rounded-full px-2 py-0.5 font-medium ${IMPACT_CLASSES[n.interpretation]}`}>{n.interpretation}</span>
            </div>
            <p className="text-xs text-(--text-faint) mt-1">
              {n.source} · {formatRelative(n.publishedAt)} · {n.topic} · {n.isPriced ? "Already priced in" : "Not yet fully priced in"}
            </p>
            <p className="text-xs text-(--text-dim) mt-2 leading-relaxed">{n.explanation}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-[11px] text-(--text-faint)">
              <span>Importance {n.importance}/100</span>
              <span>Urgency {n.urgency}/100</span>
              <span>Confidence {n.confidence}/100</span>
              <span>Expected impact: {n.expectedImpactDuration}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {n.affectedMarkets.map((m) => (
                <Link key={m} href={`/markets/${m}`} className="text-[11px] rounded-full border border-(--border) px-2 py-0.5 text-(--text-dim) hover:border-(--border-strong) hover:text-(--text)">
                  {m}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
