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


