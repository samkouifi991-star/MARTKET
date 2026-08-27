import { describe, expect, it, vi, beforeEach } from "vitest";

const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = { parse: parseMock };
    },
  };
});

import { classifyNewsWithLLM } from "./llm-news-classifier";

describe("classifyNewsWithLLM", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends only the headline/summary/source text, nothing else, to the model", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        affectedMarkets: ["EURUSD"],
        interpretation: "Bullish",
        importance: 70,
        confidence: 60,
        geopoliticalRelevance: 10,
        monetaryPolicyRelevance: 80,
        riskSentiment: "RiskOff",
        reason: "Fed signals hawkish stance per headline.",
      },
    });

    await classifyNewsWithLLM({ headline: "Fed signals rates may remain higher for longer", summary: "The Fed hinted at extended tightening.", source: "ForexFactory" });

    const call = parseMock.mock.calls[0][0];
    expect(call.messages).toHaveLength(1);
    const content = call.messages[0].content;
    expect(content).toContain("Fed signals rates may remain higher for longer");
    expect(content).toContain("The Fed hinted at extended tightening.");
    expect(content).toContain("ForexFactory");
    // No tools registered — the model cannot browse/fetch anything else.
    expect(call.tools).toBeUndefined();
  });

  it("forces structured output via output_config.format", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        affectedMarkets: [],
        interpretation: "Neutral",
        importance: 10,
        confidence: 10,
        geopoliticalRelevance: 0,
        monetaryPolicyRelevance: 0,
        riskSentiment: "Neutral",
        reason: "Not enough information.",
      },
    });
    await classifyNewsWithLLM({ headline: "Minor data release", source: "ForexFactory" });
    const call = parseMock.mock.calls[0][0];
    expect(call.output_config?.format).toBeDefined();
  });

  it("drops any affected market symbol the model invents that isn't a real instrument", async () => {
    parseMock.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        affectedMarkets: ["EURUSD", "NOTAREALSYMBOL"],
        interpretation: "Bullish",
        importance: 50,
        confidence: 50,
        geopoliticalRelevance: 0,
        monetaryPolicyRelevance: 0,
        riskSentiment: "Neutral",
        reason: "test",
      },
    });
    const result = await classifyNewsWithLLM({ headline: "Test", source: "ForexFactory" });
    expect(result.affectedMarkets).toEqual(["EURUSD"]);
  });

  it("throws rather than silently coercing when the model returns no parsed output", async () => {
    parseMock.mockResolvedValue({ stop_reason: "refusal", parsed_output: null });
    await expect(classifyNewsWithLLM({ headline: "Test", source: "ForexFactory" })).rejects.toThrow();
  });
});
