// LLM-based classification for email/Zapier-sourced news (replaces the
// keyword classifyHeadline() heuristic for this path only — that module
// stays unchanged as the fallback here and the sole classifier for the
// legacy FMP news cron, which is being deprecated separately).
//
// Grounding is enforced structurally, not just by instruction: (1) no
// tools are registered on this call — the model has no browsing/fetch
// capability, so it cannot look anything up beyond the text handed to it;
// (2) the prompt contains ONLY the received headline/summary/source, never
// a URL or the full article; (3) the system prompt explicitly instructs
// "use only the given text, never invent facts"; (4) the required `reason`
// field is stored (newsArticles.reason) so every classification is
// human-auditable against the original headline on the Admin page.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { INSTRUMENTS } from "@/lib/instruments";

const LlmNewsClassificationSchema = z.object({
  affectedMarkets: z.array(z.string()),
  interpretation: z.enum(["Bullish", "Bearish", "Mixed", "Neutral", "Unclear"]),
  importance: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  geopoliticalRelevance: z.number().min(0).max(100),
  monetaryPolicyRelevance: z.number().min(0).max(100),
  riskSentiment: z.enum(["RiskOn", "RiskOff", "Neutral"]),
  reason: z.string(),
});

export type LlmNewsClassification = z.infer<typeof LlmNewsClassificationSchema>;

const MODEL_ID = "claude-opus-5";
const KNOWN_SYMBOLS = new Set(INSTRUMENTS.map((i) => i.symbol));

const SYSTEM_PROMPT = [
  "You classify financial news headlines forwarded from Forex Factory email alerts.",
  "Use ONLY the headline, summary, and source text given to you below. Never invent facts, prices, market moves, or context not present in that text.",
  "affectedMarkets must be internal trading symbols only (e.g. EURUSD, XAUUSD, SPX500, BTCUSD) that the text plausibly affects — leave it empty if you cannot tell.",
  "If the text is ambiguous or lacks enough information for a field, choose the most neutral/uncertain value (Unclear/Neutral, low confidence, low relevance) rather than guessing.",
  "reason must be a one-sentence grounding citation back to specific words in the given text.",
].join(" ");

export async function classifyNewsWithLLM(input: { headline: string; summary?: string | null; source: string }): Promise<LlmNewsClassification & { model: string }> {
  const client = new Anthropic();

  const userContent = [`Source: ${input.source}`, `Headline: ${input.headline}`, input.summary ? `Summary: ${input.summary}` : null].filter(Boolean).join("\n");

  const response = await client.messages.parse({
    model: MODEL_ID,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    output_config: { format: zodOutputFormat(LlmNewsClassificationSchema) },
  });

  if (!response.parsed_output) {
    throw new Error(`LLM news classification failed to parse (stop_reason: ${response.stop_reason})`);
  }

  return {
    ...response.parsed_output,
    // Never trust a symbol the model invented — drop anything not in our
    // own instrument list rather than recording a shock against a market
    // that doesn't exist.
    affectedMarkets: response.parsed_output.affectedMarkets.filter((s) => KNOWN_SYMBOLS.has(s)),
    model: MODEL_ID,
  };
}
