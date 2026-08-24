import { NEWS_ARTICLES } from "@/lib/demo/news";
import { getLiveNewsFeed } from "@/lib/pipeline/news-feed";
import { NewsClient } from "./NewsClient";
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";

export const metadata = { title: "News Intelligence — Market Intelligence AI" };
export const dynamic = "force-dynamic";

export default async function NewsPage() {
  await requireEntitlement();
  const demoMode = isDemoOnly();
  const articles = demoMode
    ? [...NEWS_ARTICLES].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    : await getLiveNewsFeed(60);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">News Intelligence</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Market-tagged news with directional interpretation, importance, and confidence, classified by the same v1 keyword engine the scoring pipeline uses. Low-confidence stories are labeled &quot;mixed&quot; or &quot;unclear&quot; rather than assigned a fabricated direction.
        </p>
      </div>
      <NewsClient articles={articles} />
    </div>
  );
}
