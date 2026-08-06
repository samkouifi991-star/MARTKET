import { NEWS_ARTICLES } from "@/lib/demo/news";
import { NewsClient } from "./NewsClient";

export const metadata = { title: "News Intelligence — Market Intelligence AI" };

export default function NewsPage() {
  const articles = [...NEWS_ARTICLES].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">News Intelligence</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Deduplicated, market-tagged news with directional interpretation, importance, urgency and confidence. Low-confidence stories are labeled &quot;mixed&quot; or &quot;unclear&quot; rather than assigned a fabricated direction.
        </p>
      </div>
      <NewsClient articles={articles} />
    </div>
  );
}
