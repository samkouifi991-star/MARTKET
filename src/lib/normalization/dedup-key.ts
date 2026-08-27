// A stable dedup key for email-forwarded news, which often has no
// canonical URL (unlike FMP's news feed, where url is always the real
// dedup key). Rounds publishedAt to the minute so Zapier redelivering the
// same email a few seconds apart (e.g. a retry) still produces the same
// key, while two genuinely different articles published in the same
// minute from the same source with an identical headline are vanishingly
// unlikely and would be a real duplicate anyway.
import { createHash } from "crypto";

export function newsDedupKey(headline: string, source: string, publishedAtISO: string): string {
  const normalizedHeadline = headline.trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedSource = source.trim().toLowerCase();
  const roundedMinute = publishedAtISO.slice(0, 16); // "2026-08-26T12:31" — truncates seconds/ms
  const hash = createHash("sha256").update(`${normalizedHeadline}|${normalizedSource}|${roundedMinute}`).digest("hex");
  return `ff-news:${hash.slice(0, 40)}`;
}
