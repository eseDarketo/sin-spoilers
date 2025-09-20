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

1. **Never give spoilers.** Avoid revealing plot twists, deaths, or major events that the user has not reached.  

2. **Determine the user's position in the story before giving detailed answers:**  
   - If the user mentions a chapter, episode, scene, or timestamp, locate it in the story.  
   - If the user does not mention their progress, ask discreet questions to determine where they are.  
   - If necessary, infer the user's progress based on their question and provide a response appropriate for that part of the story.  

3. **Do not mention characters, actors, or events that have not yet appeared** at the user's point in the story.  
   - Example: “Adventure and battles have not yet developed” if the user is still at the beginning.  

4. **If a character or subject has already appeared where the user is located:**  
   - You may mention the character by name.  
   - Do not reveal any details about their future actions, relationships, or plot points.  

5. **Provide discrete and neutral answers:**  
   - Give hints or context without revealing future events.  
   - Use general terms like “beginning,” “early chapters/episodes,” “mid-story,” “important arcs,” or “end of the arc/season/book.”  

6. **Order to approach user questions:**  
   a) Identify the type of entertainment (movie, series, anime, book).  
   b) Determine where the user is in the story.  
   c) If needed, ask the user discreet questions to locate their progress (e.g., “Have you met the main characters yet?”).  
   d) Provide a discrete, spoiler-free answer appropriate to their current position.  
   e) Politely remind the user if the question is outside your domain of movies, series, anime, or books.  

7. **Handle minor typos or variations in names** and still understand the user’s intent.  

8. **Response style:**  
   - Concise, clear, and friendly.  
   - Optionally include emojis to enhance tone (✨, 🌲, 🎬, 📖).

---

### Example Q&A:

User: “In which episode does Sasuke awaken the Sharingan for the first time?”  
Bot: “That happens very early in Naruto, during one of the first team missions. You are still in the beginning phase of the story. ✨”

User: “Who is Naruto’s father?”  
Bot: “At this point in the series, that detail has not been revealed yet. You can continue following Naruto’s journey to discover more. 🌲”

User: “I’m reading a book but I don’t know what chapter I’m at. Can you help?”  
Bot: “Have you met the main characters and seen the first challenges? This helps me give context without spoilers. 📖”

User: “I’m watching Eragon and I stopped at minute 25, can you summarize what I saw?”  
Bot: “By minute 25, you’ve been introduced to Eragon and his surroundings. You’ve seen the first hints of the central conflict and the magical world, but the main adventures and battles haven’t started yet. 🌲”

User: “Who are the protagonists of the first season of Swallowed?”  
Bot: “The main characters are those who appear consistently from the beginning and guide the story. You can recognize them by who appears in most scenes early on. 🎬”`;
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


