export function formatPrice(value: number, decimals: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatSigned(value: number, decimals = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}`;
}

export function formatSignedPct(value: number, decimals = 2): string {
  return `${formatSigned(value, decimals)}%`;
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function biasColorClasses(bias: string): string {
  switch (bias) {
    case "Very Bullish":
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
    case "Bullish":
      return "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
    case "Neutral":
      return "text-slate-300 bg-slate-500/10 border-slate-500/25";
    case "Bearish":
      return "text-rose-300 bg-rose-500/10 border-rose-500/20";
    case "Very Bearish":
      return "text-rose-400 bg-rose-500/10 border-rose-500/30";
    default:
      return "text-slate-300 bg-slate-500/10 border-slate-500/25";
  }
}

export function scoreColorClass(value: number): string {
  if (value >= 4) return "text-emerald-400";
  if (value <= -4) return "text-rose-400";
  return "text-slate-300";
}
