// Parses a Forex-Factory-style numeric string as it arrives from an email/
// Zapier payload ("3.2%", "320K", "-15K", "1.2M", "-0.4", "215B", "") into a
// plain number, honestly returning value: null (never guessed) when the
// string is empty, "N/A", or otherwise unparseable — matches this
// project's never-fabricate rule (see economic-surprise.ts's own null
// handling for the same reasoning). The original raw string is always
// preserved verbatim (trimmed) alongside the parsed value so a
// normalization bug is visibly diagnosable, never silently lossy.
export type ParsedNumeric = { raw: string | null; value: number | null };

const EMPTY_VALUES = new Set(["", "n/a", "na", "-", "—"]);
const SUFFIX_SCALE: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };

export function normalizeNumericString(input: string | null | undefined): ParsedNumeric {
  if (input === null || input === undefined) return { raw: null, value: null };
  const raw = input.trim();
  if (raw === "" || EMPTY_VALUES.has(raw.toLowerCase())) return { raw: raw === "" ? null : raw, value: null };

  // Strip a trailing "%" (a unit, not a scale factor — "3.2%" already
  // stores as the plain number 3.2, matching how economic_events.actual
  // already represents e.g. a CPI print) and thousands separators, then
  // check for a K/M/B suffix before parsing.
  let text = raw.replace(/%$/, "").replace(/,/g, "").trim();
  let scale = 1;
  const suffixMatch = text.match(/([KMB])$/i);
  if (suffixMatch) {
    scale = SUFFIX_SCALE[suffixMatch[1].toUpperCase()];
    text = text.slice(0, -1);
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { raw, value: null };
  return { raw, value: parsed * scale };
}
