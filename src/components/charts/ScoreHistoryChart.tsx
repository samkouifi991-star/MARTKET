"use client";

import { ScoreHistoryPoint } from "@/lib/types";
import { formatDate } from "@/lib/time";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function ScoreHistoryChart({ history }: { history: ScoreHistoryPoint[] }) {
  const data = history.map((p) => ({ ...p, label: formatDate(p.date) }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-faint)" }} minTickGap={40} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
        <YAxis domain={[-10, 10]} tick={{ fontSize: 11, fill: "var(--text-faint)" }} width={30} axisLine={false} tickLine={false} />
        <ReferenceLine y={8} stroke="#22c58b55" strokeDasharray="4 4" />
        <ReferenceLine y={4} stroke="#22c58b33" strokeDasharray="4 4" />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        <ReferenceLine y={-4} stroke="#f2506b33" strokeDasharray="4 4" />
        <ReferenceLine y={-8} stroke="#f2506b55" strokeDasharray="4 4" />
        <Tooltip
          contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "var(--text-dim)" }}
          formatter={(value) => [Number(value).toFixed(2), "Score"]}
        />
        <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
