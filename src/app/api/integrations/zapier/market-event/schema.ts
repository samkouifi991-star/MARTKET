// Validated input shapes for the Zapier ingestion webhook. Never trust
// Zapier's raw JSON directly (requirement #3) — every field is parsed
// here before anything downstream touches it. Numeric fields arrive as
// raw strings ("3.2%", "320K") since that's what an email-forwarded
// Forex Factory alert actually contains; normalizeNumericString() parses
// them after this schema confirms shape.
import { z } from "zod";

export const EconomicEventPayload = z.object({
  type: z.literal("economic_event"),
  source: z.string().default("forex_factory_email"),
  currency: z.string().min(2).max(6),
  event: z.string().min(1),
  impact: z.enum(["low", "medium", "high", "Low", "Medium", "High"]).nullable().optional(),
  scheduledAt: z.string().datetime(),
  actual: z.string().nullable().optional(),
  forecast: z.string().nullable().optional(),
  previous: z.string().nullable().optional(),
  revisedPrevious: z.string().nullable().optional(),
  headline: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  receivedAt: z.string().datetime().optional(),
});
export type EconomicEventPayload = z.infer<typeof EconomicEventPayload>;

export const NewsPayload = z.object({
  type: z.literal("news"),
  source: z.string().default("forex_factory_email"),
  headline: z.string().min(1),
  summary: z.string().nullable().optional(),
  currencies: z.array(z.string()).optional(),
  impact: z.enum(["low", "medium", "high", "Low", "Medium", "High"]).nullable().optional(),
  publishedAt: z.string().datetime(),
  sourceUrl: z.string().nullable().optional(),
  receivedAt: z.string().datetime().optional(),
});
export type NewsPayload = z.infer<typeof NewsPayload>;

export const ZapierIngestPayload = z.discriminatedUnion("type", [EconomicEventPayload, NewsPayload]);
export type ZapierIngestPayload = z.infer<typeof ZapierIngestPayload>;

export function normalizeImpact(impact: string | null | undefined): "Low" | "Medium" | "High" | null {
  if (!impact) return null;
  const lower = impact.toLowerCase();
  if (lower === "low") return "Low";
  if (lower === "medium") return "Medium";
  if (lower === "high") return "High";
  return null;
}
