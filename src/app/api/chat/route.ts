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

    const instructions = `You are a Spoiler-Safe Story Assistant for games, movies, series, anime, and books.

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

    // Try Conversations API first. Types may not yet be in the SDK; use a permissive call shape.
    try {
      const convRes = await (client as unknown as { conversations?: { create?: (args: unknown) => Promise<unknown> } }).conversations?.create?.({
        model: "gpt-4o",
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
        model: "gpt-4o",
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
        model: "gpt-4o",
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
      model: "gpt-4o",
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


