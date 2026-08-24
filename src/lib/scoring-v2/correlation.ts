// Correlation adjustment — groups release-level surprise signals that are
// really "one story" told three ways (requirement #12's explicit examples:
// NFP + unemployment + wages is one strong Labor report, not three
// independent full-strength signals; likewise CPI+Core CPI, PPI+Core PPI,
// GDP headline+components). Grouped signals are averaged, not summed, so a
// single macro story can't inflate its own weight just by being reported
// through multiple correlated indicators.
export type ReleaseSignal = { indicatorKey: string; effectiveSurpriseZ: number };
export type CompositeSignal = { label: string; members: string[]; effectiveSurpriseZ: number };

const CORRELATION_GROUPS: { label: string; members: string[] }[] = [
  { label: "Labor report", members: ["nfp", "unemploymentRate", "avgHourlyEarnings"] },
  { label: "CPI inflation", members: ["cpi", "coreCpi"] },
  { label: "PPI inflation", members: ["ppi", "corePpi"] },
  { label: "PCE inflation", members: ["pce", "corePce"] },
  { label: "GDP growth", members: ["gdp", "gdpRevision"] },
];

/** Splits a set of same-cycle release signals into correlated composites
 * (averaged) and everything else (left as independent signals, untouched).
 * A group only forms when 2+ of its members are actually present this
 * cycle — a single CPI print with no Core CPI alongside it stays its own
 * independent signal rather than being wrapped in a trivial "group of one". */
export function groupCorrelatedSignals(signals: ReleaseSignal[]): { grouped: CompositeSignal[]; ungrouped: ReleaseSignal[] } {
  const used = new Set<string>();
  const grouped: CompositeSignal[] = [];

  for (const group of CORRELATION_GROUPS) {
    const members = signals.filter((s) => group.members.includes(s.indicatorKey));
    if (members.length < 2) continue;
    members.forEach((m) => used.add(m.indicatorKey));
    const avgZ = members.reduce((s, m) => s + m.effectiveSurpriseZ, 0) / members.length;
    grouped.push({ label: group.label, members: members.map((m) => m.indicatorKey), effectiveSurpriseZ: Number(avgZ.toFixed(3)) });
  }

  const ungrouped = signals.filter((s) => !used.has(s.indicatorKey));
  return { grouped, ungrouped };
}
