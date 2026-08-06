import { AiAnalystClient } from "./AiAnalystClient";

export const metadata = { title: "AI Analyst — Market Intelligence AI" };

export default function AiAnalystPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Market Analyst AI</h1>
        <p className="text-sm text-(--text-faint) mt-1">A conversational assistant grounded in this platform&apos;s own data — every answer cites the exact factors used.</p>
      </div>
      <AiAnalystClient />
    </div>
  );
}
