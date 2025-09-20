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

    const instructions = `You are an Entertainment ChatBot. Your task is to answer user questions about movies, TV series, anime, and books while strictly following these rules:

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

    // Try Conversations API first. Types may not yet be in the SDK; use a permissive call shape.
    try {
      const convRes: any = await (client as any).conversations?.create?.({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: instructions }, ...messages],
      });

      // Best-effort extraction across possible shapes
      const outputText =
        convRes?.output_text ??
        convRes?.message?.content ??
        convRes?.choices?.[0]?.message?.content ??
        convRes?.output?.[0]?.content?.[0]?.text ??
        "";

      if (typeof outputText === "string" && outputText.length > 0) {
        const inference = await extractInference(client, messages, outputText);
        return Response.json({ message: outputText, provider: "conversations", inference });
      }
    } catch (_) {
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
          } catch (e) {
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


