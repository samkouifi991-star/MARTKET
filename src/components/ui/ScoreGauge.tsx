import { Bias } from "@/lib/types";
import { biasColorClasses } from "@/lib/format";

// Semicircle gauge from -10 (Very Bearish) to +10 (Very Bullish).
export function ScoreGauge({ score, bias, size = 160 }: { score: number; bias: Bias; size?: number }) {
  const clamped = Math.max(-10, Math.min(10, score));
  const pct = (clamped + 10) / 20; // 0..1
  const angle = -180 + pct * 180; // -180..0 degrees
  const rad = (angle * Math.PI) / 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 14;
  const needleX = cx + r * Math.cos(rad);
  const needleY = cy + r * Math.sin(rad);

  const bands = [
    { from: -10, to: -8, color: "#f2506b" },
    { from: -8, to: -4, color: "#f2506b99" },
    { from: -4, to: 4, color: "#5c6786" },
    { from: 4, to: 8, color: "#22c58b99" },
    { from: 8, to: 10, color: "#22c58b" },
  ];

  function arcPath(from: number, to: number) {
    const a1 = -180 + ((from + 10) / 20) * 180;
    const a2 = -180 + ((to + 10) / 20) * 180;
    const p1 = polar(cx, cy, r, a1);
    const p2 = polar(cx, cy, r, a2);
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 0 1 ${p2.x} ${p2.y}`;
  }

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + 20} viewBox={`0 0 ${size} ${size / 2 + 20}`}>
        {bands.map((b) => (
          <path key={b.from} d={arcPath(b.from, b.to)} stroke={b.color} strokeWidth={10} fill="none" strokeLinecap="round" />
        ))}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="text-(--text)" />
        <circle cx={cx} cy={cy} r={4} fill="currentColor" className="text-(--text)" />
      </svg>
      <div className="text-center -mt-2">
        <div className="text-3xl font-semibold tabular-nums">{score > 0 ? "+" : ""}{score.toFixed(1)}</div>
        <span className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${biasColorClasses(bias)}`}>
          {bias}
        </span>
      </div>
    </div>
  );
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
