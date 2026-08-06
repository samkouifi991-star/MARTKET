export type HeatCell = {
  symbol: string;
  name: string;
  value: number; // signed, drives color
  displayValue: string;
};

function colorFor(value: number, maxAbs: number): string {
  const t = Math.max(-1, Math.min(1, value / (maxAbs || 1)));
  if (t >= 0) {
    const alpha = 0.12 + t * 0.55;
    return `rgba(34, 197, 139, ${alpha.toFixed(2)})`;
  }
  const alpha = 0.12 + -t * 0.55;
  return `rgba(242, 80, 107, ${alpha.toFixed(2)})`;
}

export function HeatmapGrid({ cells, maxAbs, onSelect }: { cells: HeatCell[]; maxAbs: number; onSelect?: (symbol: string) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
      {cells.map((c) => (
        <button
          key={c.symbol}
          onClick={() => onSelect?.(c.symbol)}
          style={{ background: colorFor(c.value, maxAbs) }}
          className="rounded-lg border border-(--border) p-3 text-left transition-transform hover:scale-[1.02] hover:border-(--border-strong)"
        >
          <div className="text-xs font-medium text-(--text-dim)">{c.symbol}</div>
          <div className="text-[11px] text-(--text-faint) truncate">{c.name}</div>
          <div className="mt-2 text-lg font-semibold tabular-nums">{c.displayValue}</div>
        </button>
      ))}
    </div>
  );
}
