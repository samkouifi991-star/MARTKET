import Link from "next/link";
import { INSTRUMENTS } from "@/lib/instruments";
import { generateSmartMoney } from "@/lib/demo/smartMoney";
import { generatePositioning } from "@/lib/demo/positioning";
import { generateRetailSentiment } from "@/lib/demo/retail";
import { generatePriceData } from "@/lib/demo/price";
import { Card } from "@/components/ui/Card";
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";
import { formatSigned, formatSignedPct } from "@/lib/format";

export const metadata = { title: "Smart Money — Institutional vs. Retail — Market Intelligence AI" };

export default function SmartMoneyPage() {
  const rows = INSTRUMENTS.map((instrument) => ({
    instrument,
    signal: generateSmartMoney(instrument),
    positioning: generatePositioning(instrument),
    retail: generateRetailSentiment(instrument),
    price: generatePriceData(instrument),
  })).sort((a, b) => {
    if (a.signal.signal === "None" && b.signal.signal !== "None") return 1;
    if (b.signal.signal === "None" && a.signal.signal !== "None") return -1;
    return b.signal.confidence - a.signal.confidence;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Institutional vs. Retail</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Combines price, institutional net positioning and its weekly change, and retail net positioning and its daily change to surface named divergence signals — each with an explanation and confidence level.
        </p>
      </div>

      <div className="grid gap-3">
        {rows.map((r) => (
          <Link
            key={r.instrument.symbol}
            href={`/markets/${r.instrument.symbol}`}
            className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 hover:border-(--border-strong) transition-colors"
          >
            <div className="sm:w-32 shrink-0">
              <div className="font-medium">{r.instrument.symbol}</div>
              <div className="text-xs text-(--text-faint)">{r.instrument.name}</div>
            </div>
            <div className="flex-1 min-w-0">
              <span
                className={`text-sm font-medium ${
                  r.signal.signal === "None" ? "text-(--text-faint)" : r.signal.signal.startsWith("Bullish") ? "text-emerald-400" : r.signal.signal.startsWith("Bearish") ? "text-rose-400" : "text-amber-400"
                }`}
              >
                {r.signal.signal}
              </span>
              <p className="text-xs text-(--text-dim) mt-1 leading-relaxed">{r.signal.explanation}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-(--text-faint)">
                <span>Price 24h {formatSignedPct(r.price.changePct24h)}</span>
                <span>Inst. weekly Δ {formatSigned(r.positioning.netWeeklyChange, 0)}</span>
                <span>Retail 24h Δ {formatSigned(r.retail.change24h)}</span>
              </div>
            </div>
            <div className="sm:w-32 shrink-0">
              <ConfidenceBar value={r.signal.confidence} />
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
