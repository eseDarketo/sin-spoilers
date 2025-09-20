import OpenAI from "openai";

export const runtime = "nodejs";

type APIMsg = { role: "user" | "assistant" | "system"; content: string };

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages = (body?.messages ?? []) as APIMsg[];

    const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing NEXT_PUBLIC_OPENAI_API_KEY on server" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const client = new OpenAI({ apiKey });

    const instructions = `You are an Entertainment ChatBot. Your goal is to answer user questions about movies, TV series, anime, and books while strictly following these rules:

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
        return Response.json({ message: outputText, provider: "conversations" });
      }
    } catch (_) {
      // Ignore and try fallback
    }

    // Fallback to Chat Completions if Conversations is unavailable
    const cc = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: instructions }, ...messages],
      temperature: 0.4,
    });
    const text = cc.choices?.[0]?.message?.content ?? "";
    if (text) {
      return Response.json({ message: text, provider: "chat.completions" });
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


