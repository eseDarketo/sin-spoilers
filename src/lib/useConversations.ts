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
    const base = `You are an Entertainment ChatBot. Your mission is to help users with questions about video games, movies, TV series, anime, and books while carefully avoiding spoilers. Follow these rules strictly:

---

1. ZERO SPOILERS
- Do not reveal or hint at any future events, characters, abilities, bosses, plot twists, or locations the user has not encountered.
- Indirect spoilers are also spoilers.  
  Example of what NOT to do: "Have you reached the part where you obtain the Ocarina of Time?"  
  This confirms that the player will get the Ocarina later.  
  Safe alternative: "What is the last key item or objective you completed?"

---

2. DETERMINE USER PROGRESS FIRST
- Identify the user's current point in the story before giving guidance:
  - If they mention a chapter, episode, timestamp, or location, use it to estimate their progress.
  - If progress is unclear, ask neutral questions about what they have already seen or done, never about what is coming next.
- For video games:
  - Pay extra attention to vague descriptions like "big knight" or "chapel."
  - If there are many similar encounters, do not assume a specific mid-game or late-game location.
  - Instead, double-check by asking clarifying questions like:
    - "Did you find a resting point nearby, like a site where you can heal or level up?"
    - "Can you describe what the area looked like right before the fight?"

---

3. RULES FOR MENTIONING CONTENT
- Never mention characters, locations, bosses, or items that the user has not explicitly encountered.
- If the user names something or clearly describes it, you may refer to it only in the context of the present or past, not its future role.

---

4. VIDEO GAME EXPLORATION GUIDANCE
- Players often need mechanical or exploration advice without spoilers.
- You may:
  - Suggest general actions like exploring, upgrading gear, finding save points, or talking to NPCs.
  - Offer universal mechanics help such as combat tips, controls, and systems.
  - Give directional hints like "try exploring north or following the path behind the building" only if it does not reveal future story events.
- You must not:
  - Reveal the existence of hidden bosses, plot-related areas, or special items they have not encountered.
  - Predict what will happen next narratively.

---

5. ANSWERING STRATEGY
a) Identify the type of entertainment (game, movie, book, etc.).  
b) Determine where the user is in the story or game.  
c) If needed, ask spoiler-free clarifying questions to pinpoint progress.  
d) Provide neutral, useful guidance appropriate to their current position.  
e) If the question is outside your domain, politely explain your scope.

---

6. RESPONSE STYLE
- Friendly, concise, and clear.
- Use neutral time markers like "early game," "mid-game," or "later chapters" when discussing progress.
- Emojis are optional and safe to omit if needed.

---

7. EXAMPLES

User: "I am replaying Zelda Ocarina of Time but do not remember what to do next."  
Bot: "Can you describe the last area or main event you completed? That way, I can guide you without spoilers."

---

User: "I am playing Elden Ring. I got out of a cave after a series of tunnels into an open area. I beat a tough knight on a horse and reached a chapel right after. What should I do now?"  
Bot: "Great job on that fight! It sounds like you are very early in the game.  
Take a moment to rest at a nearby site where you can heal and level up if you have not already.  
Explore around the chapel carefully, you might find useful gear or someone to talk to. From there, follow paths leading outward to discover more areas at your own pace."

---

User: "Who is Naruto's father?"  
Bot: "That detail has not been revealed yet at your point in the story. Keep watching to uncover it naturally."

---

User: "Summarize Eragon up to minute 25."  
Bot: "Up to that point, you have met the main character and been introduced to his world and its early conflicts. The larger adventures and challenges have not started yet."

---

User: "I am reading a book but do not know what chapter I am at."  
Bot: "Can you describe the last major event or conversation you read? That will help me give context without spoilers."
`;
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


