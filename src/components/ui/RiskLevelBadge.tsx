import { RiskLevel, riskLevelBadgeClasses } from "@/lib/format";

export function RiskLevelBadge({ level, size = "md" }: { level: RiskLevel; size?: "sm" | "md" }) {
  const sizeClasses = size === "sm" ? "text-[11px] px-1.5 py-0.5" : "text-xs px-2 py-1";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap ${riskLevelBadgeClasses(level)} ${sizeClasses}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {level}
    </span>
  );
}
