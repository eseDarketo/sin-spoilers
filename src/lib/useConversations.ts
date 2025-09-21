"use client";

import { useCallback, useRef, useState } from "react";

export type ChatRole = "user" | "assistant" | "system";
export type ChatMessage = { id: string; role: ChatRole; content: string };
export type Inference = { mediaType: string; title: string; position: string };

export function useConversations(options?: { dangerMode?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inference, setInference] = useState<Inference | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // No client-side system prompt. The server controls the system instructions,
  // optionally switching to danger-mode (videogames-only spoilers) based on a flag.

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
          dangerMode: Boolean(options?.dangerMode),
          messages: [
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
          dangerMode: Boolean(options?.dangerMode),
          messages: [
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
  }, [isLoading, messages, options?.dangerMode]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  return { messages, isLoading, send, clear, inference, isStreaming } as const;
}


