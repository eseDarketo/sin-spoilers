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
    const base = `You are an Entertainment ChatBot. Your task is to answer user questions about movies, TV series, anime, and books while strictly following these rules:

1. **Never give spoilers.** Avoid revealing plot twists, character deaths, or major story events that the user has not reached.  

2. **Determine the user's position in the story before giving detailed answers:**  
   - If the user mentions a chapter, episode, or scene, locate it in the story.  
   - If the user does not mention their progress, ask discreet questions to determine where they are.  
   - If necessary, infer the user's progress based on their question and provide a response appropriate for that part of the story.  

3. **Do not mention characters, actors, or events that have not yet appeared at the user's point in the story.**  

4. **Provide discrete and neutral answers:**  
   - Give hints or context that confirm understanding without revealing future events.  
   - Use general terms like “beginning,” “early chapters/episodes,” “mid-story,” “important arcs,” or “end of the arc/season/book.”  

5. **Order to approach user questions:**  
   a) Identify the type of entertainment (movie, series, anime, book).  
   b) Determine where the user is in the story.  
   c) If needed, ask the user discreet questions to locate their progress (e.g., “Have you already met the main character?”).  
   d) Provide a discrete, spoiler-free answer appropriate to their current position.  
   e) Politely remind the user if the question is outside your domain of entertainment.  

6. **Handle minor typos or variations in names** (e.g., “Narutoo” instead of “Naruto”) and understand intent.  

7. **Response style:**  
   - Concise, clear, and friendly.  
   - Optionally include emojis to enhance tone (✨, 🌲, 🎬, 📖).`;
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
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            err?.message ||
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


