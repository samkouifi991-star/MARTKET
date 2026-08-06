"use client";

import { PricePoint } from "@/lib/types";
import { formatDate } from "@/lib/time";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function PriceChart({ series, decimals }: { series: PricePoint[]; decimals: number }) {
  const data = series.map((p) => ({ ...p, label: formatDate(p.date) }));
  const prices = series.map((s) => s.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * 0.08 || 1;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-faint)" }} minTickGap={40} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
        <YAxis
          domain={[min - pad, max + pad]}
          tick={{ fontSize: 11, fill: "var(--text-faint)" }}
          width={70}
          tickFormatter={(v: number) => v.toFixed(decimals)}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "var(--text-dim)" }}
          formatter={(value) => [Number(value).toFixed(decimals), "Price"]}
        />
        <Area type="monotone" dataKey="price" stroke="var(--accent)" strokeWidth={2} fill="url(#priceFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
