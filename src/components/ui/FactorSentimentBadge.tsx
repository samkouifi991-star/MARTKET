import { FactorSentiment, factorSentimentBadgeClasses } from "@/lib/format";

export function FactorSentimentBadge({ sentiment }: { sentiment: FactorSentiment }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${factorSentimentBadgeClasses(sentiment)}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {sentiment}
    </span>
  );
}
