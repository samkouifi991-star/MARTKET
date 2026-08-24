import Link from "next/link";
import { INSTRUMENTS } from "@/lib/instruments";
import { generateSmartMoney } from "@/lib/demo/smartMoney";
import { generatePositioning } from "@/lib/demo/positioning";
import { generateRetailSentiment } from "@/lib/demo/retail";
import { generatePriceData } from "@/lib/demo/price";
import { getAllLiveMarketDetails } from "@/lib/pipeline/market-detail";
import { Card } from "@/components/ui/Card";
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";
import { formatSigned, formatSignedPct } from "@/lib/format";
import { requireEntitlement } from "@/lib/auth/dal";
import { DATA_MODE, isDemoOnly } from "@/services/data-mode";

export const metadata = { title: "Smart Money — Institutional vs. Retail — Market Intelligence AI" };
export const dynamic = "force-dynamic";

type Row = {
  symbol: string;
  name: string;
  signal: string;
  confidence: number;
  explanation: string;
  priceChangePct24h: number | null;
  instWeeklyChange: number | null;
  retailChange24h: number | null;
};

export default async function SmartMoneyPage() {
  await requireEntitlement();
  const demoMode = isDemoOnly();

  let rows: Row[];
  if (demoMode) {
    rows = INSTRUMENTS.map((instrument) => {
      const signal = generateSmartMoney(instrument);
      const positioning = generatePositioning(instrument);
      const retail = generateRetailSentiment(instrument);
      const price = generatePriceData(instrument);
      return {
        symbol: instrument.symbol,
        name: instrument.name,
        signal: signal.signal,
        confidence: signal.confidence,
        explanation: signal.explanation,
        priceChangePct24h: price.changePct24h,
        instWeeklyChange: positioning.netWeeklyChange,
        retailChange24h: retail.change24h,
      };
    });
  } else {
    const all = await getAllLiveMarketDetails(DATA_MODE);
    rows = all.map(({ instrument, detail }) => ({
      symbol: instrument.symbol,
      name: instrument.name,
      signal: detail.smartMoney.data?.signal ?? "None",
      confidence: detail.smartMoney.data?.confidence ?? 0,
      explanation: detail.smartMoney.data?.explanation ?? (detail.smartMoney.reason ?? "Smart Money data currently unavailable for this market."),
      priceChangePct24h: detail.price.data?.changePct24h ?? null,
      instWeeklyChange: detail.institutional.data?.netWeeklyChange ?? null,
      retailChange24h: null, // no real per-symbol 24h retail-sentiment delta stored yet — omitted rather than estimated
    }));
  }

  const sorted = [...rows].sort((a, b) => {
    if (a.signal === "None" && b.signal !== "None") return 1;
    if (b.signal === "None" && a.signal !== "None") return -1;
    return b.confidence - a.confidence;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Institutional vs. Retail</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Combines price, institutional net positioning and its weekly change, and retail positioning to surface named divergence signals — each with an explanation and confidence level.
        </p>
      </div>

      <div className="grid gap-3">
        {sorted.map((r) => (
          <Link
            key={r.symbol}
            href={`/markets/${r.symbol}`}
            className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 hover:border-(--border-strong) transition-colors"
          >
            <div className="sm:w-32 shrink-0">
              <div className="font-medium">{r.symbol}</div>
              <div className="text-xs text-(--text-faint)">{r.name}</div>
            </div>
            <div className="flex-1 min-w-0">
              <span
                className={`text-sm font-medium ${
                  r.signal === "None" ? "text-(--text-faint)" : r.signal.startsWith("Bullish") ? "text-emerald-400" : r.signal.startsWith("Bearish") ? "text-rose-400" : "text-amber-400"
                }`}
              >
                {r.signal}
              </span>
              <p className="text-xs text-(--text-dim) mt-1 leading-relaxed">{r.explanation}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-(--text-faint)">
                {r.priceChangePct24h !== null && <span>Price 24h {formatSignedPct(r.priceChangePct24h)}</span>}
                {r.instWeeklyChange !== null && <span>Inst. weekly Δ {formatSigned(r.instWeeklyChange, 0)}</span>}
                {r.retailChange24h !== null && <span>Retail 24h Δ {formatSigned(r.retailChange24h)}</span>}
              </div>
            </div>
            <div className="sm:w-32 shrink-0">
              <ConfidenceBar value={r.confidence} />
            </div>
          </Link>
        ))}
      </div>

      <Card title="Signal glossary">
        <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Glossary term="Bullish Smart Money Divergence" def="Institutions accumulating while retail traders lean short." />
          <Glossary term="Bearish Smart Money Divergence" def="Institutions distributing while retail traders lean long." />
          <Glossary term="Crowded Institutional Trade" def="Institutional positioning at a historical extreme without price confirmation — elevated reversal risk." />
          <Glossary term="Retail Capitulation" def="Extreme retail positioning moving further against the prevailing price trend." />
          <Glossary term="Positioning Reversal" def="Institutional weekly flow and the retail sentiment trend point in opposite directions." />
        </dl>
      </Card>
    </div>
  );
}

function Glossary({ term, def }: { term: string; def: string }) {
  return (
    <div>
      <dt className="font-medium">{term}</dt>
      <dd className="text-(--text-faint) text-xs mt-0.5">{def}</dd>
    </div>
  );
}
