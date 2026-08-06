// Fixed reference "now" for all demo data generation. Using a real live clock
// would make server- and client-rendered relative timestamps drift and cause
// hydration mismatches; a fixed anchor keeps the whole demo deterministic.
export const NOW = new Date("2026-08-06T16:00:00Z");

export function isoOffset(hours: number): string {
  return new Date(NOW.getTime() + hours * 3600_000).toISOString();
}

export function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

export function formatRelative(iso: string): string {
  const diffMs = NOW.getTime() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 0) {
    const futureMins = -mins;
    if (futureMins < 60) return `in ${futureMins}m`;
    if (futureMins < 1440) return `in ${Math.round(futureMins / 60)}h`;
    return `in ${Math.round(futureMins / 1440)}d`;
  }
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}
