"use client";

import { useState } from "react";
import { answerQuestion, SAMPLE_QUESTIONS } from "@/lib/aiAnalyst";
import { Bot, Send, User } from "lucide-react";

type Message = { role: "user" | "assistant"; text: string; citations?: string[] };

export function AiAnalystClient() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "I'm Market Analyst AI. Ask me about any market's score, recent changes, positioning divergences, or upcoming events — I only answer from data already on this platform and cite the exact factors I used.",
    },
  ]);
  const [input, setInput] = useState("");

  function ask(question: string) {
    if (!question.trim()) return;
    const answer = answerQuestion(question);
    setMessages((prev) => [...prev, { role: "user", text: question }, { role: "assistant", text: answer.text, citations: answer.citations }]);
    setInput("");
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-220px)] min-h-[420px]">
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`grid place-items-center w-7 h-7 rounded-full shrink-0 ${m.role === "assistant" ? "bg-(--accent-soft) text-(--accent)" : "bg-white/[.06] text-(--text-dim)"}`}>
              {m.role === "assistant" ? <Bot size={14} /> : <User size={14} />}
            </div>
            <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${m.role === "assistant" ? "card" : "bg-(--accent-soft) text-(--text)"}`}>
              <p>{m.text}</p>
              {m.citations && m.citations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {m.citations.map((c) => (
                    <span key={c} className="text-[10px] rounded-full border border-(--border) px-1.5 py-0.5 text-(--text-faint)">{c}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="pt-3">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {SAMPLE_QUESTIONS.map((q) => (
            <button key={q} onClick={() => ask(q)} className="text-[11px] rounded-full border border-(--border) px-2.5 py-1 text-(--text-faint) hover:border-(--border-strong) hover:text-(--text-dim)">
              {q}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about any market, score, or divergence…"
            className="flex-1 h-10 rounded-lg border border-(--border) bg-(--bg-card) px-3 text-sm outline-none"
          />
          <button type="submit" className="h-10 w-10 grid place-items-center rounded-lg bg-(--accent) text-white shrink-0">
            <Send size={15} />
          </button>
        </form>
        <p className="text-[10px] text-(--text-faint) mt-2">
          Market Analyst AI answers using platform data only. It does not guarantee trade outcomes and is not investment advice.
        </p>
      </div>
    </div>
  );
}
