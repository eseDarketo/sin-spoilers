"use client";

import { useCallback, useMemo, useRef, useState } from "react";

export type ChatRole = "user" | "assistant" | "system";
export type ChatMessage = { id: string; role: ChatRole; content: string };
export type Inference = { mediaType: string; title: string; position: string };

export function useConversations(options?: { systemPrompt?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inference, setInference] = useState<Inference | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const systemMessage = useMemo(() => {
    const base = `You are a Spoiler-Safe Story Assistant for games, movies, series, anime, and books.

Your objectives, in order:
1) Identify the user's current point in the story or game.
2) If that point is unclear, ask up to 3 targeted, spoiler-free clarifying questions about what they have ALREADY seen or done.
3) Answer strictly based on what has happened up to (and including) their point. Pretend the rest of the story does not exist.

Hard rules:
- ZERO spoilers: never reveal or hint at events, characters, locations, items, twists, relationships, abilities, or bosses beyond the user's point.
- Do not imply future content. Avoid questions that forecast upcoming events.
- Do not reuse example phrasings; tailor responses to the user’s wording and language.
- Only refuse if the user explicitly asks for future information after you have established that they are before that reveal.

Progress-first behavior:
- Use any chapter/episode/timestamp/location the user provides to estimate progress.
- If uncertain, ask neutral questions that reference only past/seen content, e.g.:
  - For series/anime: "What is the last scene or episode you watched?"
  - For movies: "What was the last major scene you remember?"
  - For books: "What is the last chapter or key event you read?"
  - For games: "Describe the last area, boss, or objective you completed."

Answering policy:
- When confident about their point, answer within that scope only.
- For identity-type questions (e.g., "Who is X's father?"):
  - If that identity is revealed by the user’s point, you may state it plainly.
  - If not yet revealed at their point, say it has not been revealed yet for them and (if needed) ask 1 clarifying question to confirm their progress.
- Keep answers concise, friendly, and helpful. No filler apologies.

Response flow:
1) Briefly acknowledge or infer their current point; if unclear, ask targeted clarifiers (no partial answer yet).
2) Once clear, provide the spoiler-safe answer or guidance limited strictly to their point.
3) If outside scope, say so briefly and pivot to a helpful, spoiler-free next step.`;
    return options?.systemPrompt ?? base;
  }, [options?.systemPrompt]);

  const send = useCallback(async (userText: string) => {
    const text = userText.trim();
    if (!text || isLoading) return;

    setIsLoading(true);
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      // Streaming request first
      setIsStreaming(true);
      const streamRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          stream: true,
          messages: [
            { role: "system", content: systemMessage },
            ...messages.map(({ role, content }) => ({ role, content })),
            { role: "user", content: text },
          ],
        }),
      });
      let assistantText = "";
      if (streamRes.ok && streamRes.body) {
        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          assistantText += decoder.decode(value, { stream: true });
          // Render partial text with a caret pointer
          setMessages((prev) => {
            const base = prev.filter((m) => m.role !== "assistant" || m.id !== "__stream");
            return [...base, { id: "__stream", role: "assistant", content: assistantText + "\u258D" }];
          });
        }
      }
      setIsStreaming(false);

      // Replace the streaming placeholder with final text
      setMessages((prev) => {
        const base = prev.filter((m) => m.id !== "__stream");
        return assistantText
          ? [...base, { id: crypto.randomUUID(), role: "assistant", content: assistantText }]
          : base;
      });

      // Fetch inference after we have the answer
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          inferOnly: true,
          lastAnswer: assistantText,
          messages: [
            { role: "system", content: systemMessage },
            ...messages.map(({ role, content }) => ({ role, content })),
            { role: "user", content: text },
          ],
        }),
      });

      const data: { inference?: Inference; error?: string } = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Request failed: ${res.status}`);
      }
      if (data?.inference) setInference(data.inference);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: message ||
            "Lo siento, hubo un problema al responder. Intenta de nuevo en un momento.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, messages, systemMessage]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  return { messages, isLoading, send, clear, inference, isStreaming } as const;
}


