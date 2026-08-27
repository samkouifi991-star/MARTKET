"use server";

// Admin -> Manual Data Entry's write path. Calls the EXACT SAME canonical
// ingestion functions (src/lib/ingestion/economic-event.ts, news.ts) the
// email/Zapier webhook calls — same Zod validation
// (integrations/zapier/market-event/schema.ts), same
// normalize->save->surprise->affected-markets->recompute pipeline, with
// channel:"manual"/provider:"manual-admin" as the only difference. This is
// what makes "manual entry and Zapier must call the same internal
// processing functions" literally true, not just described — there is no
// second, parallel implementation here.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import { EconomicEventPayload, NewsPayload } from "@/app/api/integrations/zapier/market-event/schema";
import { ingestEconomicEvent } from "@/lib/ingestion/economic-event";
import { ingestNews } from "@/lib/ingestion/news";

export type ManualEntryActionState =
  | { error: string; success?: undefined }
  | { success: string; error?: undefined }
  | undefined;

function revalidateAffectedSurfaces() {
  for (const path of ["/economic-calendar", "/news", "/admin/incoming-data", "/dashboard", "/top-setups", "/heatmap"]) {
    revalidatePath(path);
  }
  revalidatePath("/markets", "layout"); // covers /markets and every /markets/[symbol]
}

/** Combines a date input + a UTC time input into an ISO instant. The form
 * asks explicitly for UTC — this is a human keying in a Forex Factory
 * release time, so an explicit unambiguous zone beats guessing the
 * admin's browser timezone. */
function toIsoInstant(dateField: FormDataEntryValue | null, timeField: FormDataEntryValue | null): string | null {
  const date = typeof dateField === "string" ? dateField.trim() : "";
  const time = typeof timeField === "string" && timeField.trim() ? timeField.trim() : "00:00";
  if (!date) return null;
  const iso = `${date}T${time}:00.000Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : new Date(iso).toISOString();
}

function textOrNull(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function submitManualEconomicRelease(_prev: ManualEntryActionState, formData: FormData): Promise<ManualEntryActionState> {
  await requireAdmin();

  const scheduledAt = toIsoInstant(formData.get("releaseDate"), formData.get("releaseTime"));
  if (!scheduledAt) return { error: "Release date is required (and must be a valid date)." };

  const currency = textOrNull(formData.get("currency"));
  const event = textOrNull(formData.get("event"));
  if (!currency || !event) return { error: "Currency and Event are required." };

  const raw = {
    type: "economic_event" as const,
    source: "manual_admin_entry",
    currency,
    event,
    impact: textOrNull(formData.get("impact")),
    scheduledAt,
    actual: textOrNull(formData.get("actual")),
    forecast: textOrNull(formData.get("forecast")),
    previous: textOrNull(formData.get("previous")),
    revisedPrevious: textOrNull(formData.get("revisedPrevious")),
    summary: textOrNull(formData.get("notes")),
  };

  const parsed = EconomicEventPayload.safeParse(raw);
  if (!parsed.success) return { error: `Invalid entry: ${parsed.error.issues.map((i) => i.message).join("; ")}` };

  const result = await ingestEconomicEvent(parsed.data, { channel: "manual", provider: "manual-admin", dryRun: false, rawPayload: raw });
  revalidateAffectedSurfaces();

  if (result.dryRun) return { error: "Unexpected dry-run result from a live submission." };
  const recomputeNote = result.recomputedMarkets.length > 0 ? ` Recomputed: ${result.recomputedMarkets.join(", ")}.` : "";
  return { success: `Saved — ${result.processingStatus === "classified" ? "surprise-scored" : "stored (unclassified indicator)"}.${recomputeNote}` };
}

export async function submitManualNewsEvent(_prev: ManualEntryActionState, formData: FormData): Promise<ManualEntryActionState> {
  await requireAdmin();

  const publishedAt = toIsoInstant(formData.get("publishedDate"), formData.get("publishedTime"));
  if (!publishedAt) return { error: "Published date is required (and must be a valid date)." };

  const headline = textOrNull(formData.get("headline"));
  const source = textOrNull(formData.get("source"));
  if (!headline || !source) return { error: "Headline and Source are required." };

  const currencyField = textOrNull(formData.get("currency"));

  const raw = {
    type: "news" as const,
    source,
    headline,
    summary: textOrNull(formData.get("summary")),
    currencies: currencyField ? [currencyField] : undefined,
    impact: textOrNull(formData.get("impact")),
    publishedAt,
    sourceUrl: textOrNull(formData.get("sourceUrl")),
  };

  const parsed = NewsPayload.safeParse(raw);
  if (!parsed.success) return { error: `Invalid entry: ${parsed.error.issues.map((i) => i.message).join("; ")}` };

  const result = await ingestNews(parsed.data, { channel: "manual", dryRun: false, rawPayload: raw });
  revalidateAffectedSurfaces();

  if (result.dryRun) return { error: "Unexpected dry-run result from a live submission." };
  if (result.duplicate) return { success: "Already recorded — this exact headline/source/time was previously submitted (deduped)." };
  const recomputeNote = result.recomputedMarkets.length > 0 ? ` Recomputed: ${result.recomputedMarkets.join(", ")}.` : "";
  return { success: `Saved and classified.${recomputeNote}` };
}
