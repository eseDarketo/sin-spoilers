import OpenAI from "openai";

export const runtime = "nodejs";

type APIMsg = { role: "user" | "assistant" | "system"; content: string };
type Inference = { mediaType: string; title: string; position: string };

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages = (body?.messages ?? []) as APIMsg[];
    const stream = Boolean(body?.stream);
    const inferOnly = Boolean(body?.inferOnly);
    const lastAnswer = String(body?.lastAnswer ?? "");

    const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing NEXT_PUBLIC_OPENAI_API_KEY on server" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const client = new OpenAI({ apiKey });

    // Inference-only mode (used after streaming completes)
    if (inferOnly) {
      const inference = await extractInference(client, messages, lastAnswer);
      return Response.json({ inference });
    }

    const instructions = `You are an Entertainment ChatBot. Your mission is to help users with questions about video games, movies, TV series, anime, and books without ever revealing spoilers. Follow these rules strictly:

1. **Absolutely zero spoilers.**  
   - Do NOT reveal or hint at any future events, plot points, character developments, relationships, or twists.  
   - Even indirect hints that allow the user to **infer** something about the future are spoilers and must be avoided.  
    - Example of forbidden spoiler: "Have you reached the point where you obtain the Ocarina of Time?"  
      -> This reveals that the user will eventually obtain it.  
    - Instead, ask neutrally: "Can you tell me about the last main objective you completed?"

2. **Determine the user's progress before answering:**  
    - If the user gives a chapter, episode, timestamp, or location, use it to understand where they are.  
    - If progress is unclear, ask neutral, non-revealing questions about what they have already seen or done, not what might come next.  
   - Avoid framing questions that imply upcoming events or items.

3. **Do not mention characters, places, events, or items that the user has not already encountered.**  
   - If they have not explicitly mentioned something, treat it as if it does not exist.  
    - Use general descriptors like "an important character," "a major event," or "a challenging area" without naming or describing it.

4. **When something has already been introduced:**  
   - You may refer to it by name or detail, but **only in the context of the present or past**.  
   - Never provide information about what will happen to it or how it connects to the future.

5. **Answer discreetly and neutrally:**  
    - Use vague time markers like "early game," "mid-story," "near the finale," rather than concrete predictions.  
    - If giving hints, make them universal and not tied to unrevealed story elements.  
    - Example: Instead of "You'll need a new ability soon," say, "It may help to revisit earlier areas or talk to NPCs you've met."

6. **Safe questioning strategy:**  
   - Start by identifying the type of content: game, movie, book, etc.  
   - Ask ONLY about things the user has directly experienced or mentioned.  
   - If unclear, prompt them like:  
      - "Can you describe the last boss you defeated or area you explored?"  
      - "What's the last chapter or scene you remember reading or watching?"

7. **Response structure:**  
   a) Identify context (type of media, user’s progress).  
   b) Ask clarifying questions if needed — always spoiler-free.  
   c) Give helpful, neutral guidance appropriate for their current position.  
   d) If the question is unrelated to entertainment, politely explain your scope.  

8. **Minor typos and name variations:**  
   - Understand user intent even with misspellings or alternate names.

9. **Response style:**  
   - Be concise, clear, and friendly.  
   - Optional emojis to set tone (✨, 🎮, 🎬, 📖)."`;

    // Try Conversations API first. Types may not yet be in the SDK; use a permissive call shape.
    try {
      const convRes = await (client as unknown as { conversations?: { create?: (args: unknown) => Promise<unknown> } }).conversations?.create?.({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: instructions }, ...messages],
      });

      // Best-effort extraction across possible shapes
      type ConvMaybe = {
        output_text?: unknown;
        message?: { content?: unknown };
        choices?: Array<{ message?: { content?: unknown } }>;
        output?: Array<{ content?: Array<{ text?: unknown }> }>;
      } | undefined;
      const anyRes = convRes as ConvMaybe;
      const outputTextCandidate =
        (anyRes?.output_text as unknown) ??
        (anyRes?.message?.content as unknown) ??
        (anyRes?.choices?.[0]?.message?.content as unknown) ??
        (anyRes?.output?.[0]?.content?.[0]?.text as unknown) ??
        "";
      const outputText = typeof outputTextCandidate === "string" ? outputTextCandidate : "";

      if (typeof outputText === "string" && outputText.length > 0) {
        const inference = await extractInference(client, messages, outputText);
        return Response.json({ message: outputText, provider: "conversations", inference });
      }
    } catch {
      // Ignore and try fallback
    }

    // Fallback to Chat Completions if Conversations is unavailable
    if (stream) {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: instructions }, ...messages],
        temperature: 0.4,
        stream: true,
      });

      const encoder = new TextEncoder();
      const rs = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const chunk of completion) {
              const delta = chunk.choices?.[0]?.delta?.content || "";
              if (delta) controller.enqueue(encoder.encode(delta));
            }
          } catch {
            // ignore; client may abort
          } finally {
            controller.close();
          }
        },
      });

      return new Response(rs, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    } else {
      const cc = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: instructions }, ...messages],
        temperature: 0.4,
      });
      const text = cc.choices?.[0]?.message?.content ?? "";
      if (text) {
        const inference = await extractInference(client, messages, text);
        return Response.json({ message: text, provider: "chat.completions", inference });
      }
    }
    return new Response(
      JSON.stringify({ error: "Empty response from model" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("/api/chat error", error);
    return new Response(JSON.stringify({ error: "Failed to generate response" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function extractInference(client: OpenAI, history: APIMsg[], lastAnswer: string) {
  try {
    const sys =
      "From the chat so far, infer the entertainment content and the user's current point in the timeline. " +
      "Return ONLY a compact JSON object with fields: mediaType (one of: movie, series, anime, book, videogame), title, position. " +
      "If unknown, use empty strings. Do not include extra text.";
    const result = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        ...history,
        { role: "assistant", content: lastAnswer },
        { role: "user", content: "Return the JSON now." },
      ],
      temperature: 0,
    });
    const text = result.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = JSON.parse(text);
      return {
        mediaType: String(parsed.mediaType || ""),
        title: String(parsed.title || ""),
        position: String(parsed.position || ""),
      } as Inference;
    } catch {
      return { mediaType: "", title: "", position: "" } as Inference;
    }
  } catch {
    return { mediaType: "", title: "", position: "" } as Inference;
  }
}


