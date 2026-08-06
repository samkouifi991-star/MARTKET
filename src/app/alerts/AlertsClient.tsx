"use client";

import { useState } from "react";
import { AlertHistoryItem, AlertRule } from "@/lib/types";
import { INSTRUMENTS } from "@/lib/instruments";
import { Card } from "@/components/ui/Card";
import { formatRelative } from "@/lib/time";
import { Bell, Plus, Trash2 } from "lucide-react";

const ALERT_TYPES: AlertRule["type"][] = [
  "Score threshold",
  "Bias change",
  "Confidence increase",
  "Institutional shift",
  "Retail extreme",
  "Smart money divergence",
  "High-impact release",
  "Major news",
  "Technical reversal",
  "Risk gauge change",
  "Watchlist entry",
];

export function AlertsClient({ initialRules, history }: { initialRules: AlertRule[]; history: AlertHistoryItem[] }) {
  const [rules, setRules] = useState(initialRules);
  const [symbol, setSymbol] = useState(INSTRUMENTS[0].symbol);
  const [type, setType] = useState<AlertRule["type"]>("Score threshold");
  const [condition, setCondition] = useState("");

  function addRule() {
    if (!condition.trim()) return;
    const newRule: AlertRule = {
      id: `al-${Date.now()}`,
      symbol,
      type,
      condition: condition.trim(),
      channels: ["In-app"],
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    // De-dupe: an identical active rule (same symbol + type + condition) is not added twice.
    setRules((prev) => (prev.some((r) => r.symbol === newRule.symbol && r.type === newRule.type && r.condition === newRule.condition) ? prev : [newRule, ...prev]));
    setCondition("");
  }

  function toggleRule(id: string) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  }

  function removeRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="space-y-6">
      <Card title="Create alert">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[11px] text-(--text-faint) mb-1">Market</label>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-8 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-xs">
              {INSTRUMENTS.map((i) => (
                <option key={i.symbol} value={i.symbol}>{i.symbol}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-(--text-faint) mb-1">Trigger</label>
            <select value={type} onChange={(e) => setType(e.target.value as AlertRule["type"])} className="h-8 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-xs">
              {ALERT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] text-(--text-faint) mb-1">Condition</label>
            <input
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="e.g. Total score crosses above +8"
              className="h-8 w-full rounded-lg border border-(--border) bg-(--bg-card) px-2 text-xs outline-none"
            />
          </div>
          <button onClick={addRule} className="h-8 flex items-center gap-1 rounded-lg bg-(--accent) text-white px-3 text-xs font-medium">
            <Plus size={13} /> Add alert
          </button>
        </div>
        <p className="text-[11px] text-(--text-faint) mt-2">In-app notifications are available now. Email delivery is available on Pro; SMS, push and webhooks ship in a later phase.</p>
      </Card>

      <Card title="Active rules">
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-b border-(--border) last:border-0">
              <div>
                <div className="text-sm">
                  <span className="font-medium">{r.symbol}</span> <span className="text-(--text-faint)">— {r.type}</span>
                </div>
                <div className="text-xs text-(--text-dim)">{r.condition}</div>
                <div className="flex gap-1 mt-1">
                  {r.channels.map((c) => (
                    <span key={c} className="text-[10px] rounded-full border border-(--border) px-1.5 py-0.5 text-(--text-faint)">{c}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleRule(r.id)}
                  className={`h-6 w-10 rounded-full transition-colors relative ${r.enabled ? "bg-(--accent)" : "bg-(--border-strong)"}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${r.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
                <button onClick={() => removeRule(r.id)} className="text-(--text-faint) hover:text-rose-400">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {rules.length === 0 && <p className="text-sm text-(--text-faint)">No alert rules yet.</p>}
        </div>
      </Card>

      <Card title="Recent alert history">
        <ul className="space-y-2.5">
          {history.map((h) => (
            <li key={h.id} className="flex items-start gap-2.5 text-sm">
              <Bell size={14} className="text-(--accent) mt-0.5 shrink-0" />
              <div>
                <span>{h.message}</span>
                <div className="text-xs text-(--text-faint)">{formatRelative(h.triggeredAt)} · via {h.channel}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
