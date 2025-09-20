"use client";

import { useCallback, useMemo, useRef, useState } from "react";

export type ChatRole = "user" | "assistant" | "system";
export type ChatMessage = { id: string; role: ChatRole; content: string };

export function useConversations(options?: { systemPrompt?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const systemMessage = useMemo(() => {
    const base = `You are an Entertainment ChatBot. Your goal is to answer user questions about movies, TV series, anime, and books while strictly following these rules:

1. **Never give spoilers**. Always avoid revealing plot twists, character deaths, or major story events that the user has not reached.  

2. **Determine where the user is in the story** before giving answers:  
   - If the user mentions a chapter, episode, or scene, locate it in the story.  
   - If the user does not mention their progress, ask clarifying questions discreetly to find out where they are.  
   - If necessary, infer the user’s position based on their question and provide a response that is appropriate for that part of the story without giving spoilers.  

3. **Answer discretely and neutrally**:  
   - Give hints or context that confirm understanding but do not reveal future events.  
   - Use generic terms like “beginning,” “early chapters/episodes,” “mid-story,” “important arcs,” “climactic moments,” or “conclusion of the arc/season/book.”  

4. **Order to approach user questions**:  
   a) Identify the type of entertainment: movie, series, anime, or book.  
   b) Determine where the user is in the story.  
   c) If needed, ask the user a discreet question to locate their progress (e.g., “Have you met [character] yet?”).  
   d) Provide a discrete answer appropriate to their progress.  
   e) Remind the user politely if the question falls outside your domain of movies, series, anime, or books.  

5. **Handle minor typos or variations in names** (e.g., “Narutoo” instead of “Naruto”) and still understand the intent.  

6. **Response style**:  
   - Concise, clear, and friendly.  
   - Can include emojis to enhance tone (e.g., ✨, 🌲, 🎬, 📖).`;
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
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemMessage },
            ...messages.map(({ role, content }) => ({ role, content })),
            { role: "user", content: text },
          ],
        }),
      });

      const data: { message?: string; error?: string } = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Request failed: ${res.status}`);
      }
      const assistantText = (data.message ?? "").trim();
      if (assistantText) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: assistantText },
        ]);
      }
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

  return { messages, isLoading, send, clear } as const;
}


