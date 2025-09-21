"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { useConversations } from "@/lib/useConversations";

export default function Home() {
  const [dangerMode, setDangerMode] = useState(false);
  const { messages, isLoading, send, inference, isStreaming } = useConversations({ dangerMode });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const hasMessages = messages.length > 0;

  function autoResizeTextArea() {
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(160, el.scrollHeight) + "px";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  function onSubmit() {
    const trimmed = input.trim();
    if (!trimmed) return;
    send(trimmed);
    setInput("");
    // Reset textarea height so it doesn't stay expanded after sending
    const el = textAreaRef.current;
    if (el) {
      el.style.height = "auto";
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1">
        {hasMessages ? (
          <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="mx-auto px-4 lg:px-8 py-3">
              <div className="grid grid-cols-1 gap-2 items-center lg:grid-cols-12">
                <div className="text-left lg:col-span-4">
                  <p className="text-md font-semibold">Sin Spoilers</p>
                  <p className="text-sm text-muted-foreground">This is not the bot you&apos;re looking for 🤚</p>
                </div>
                <div className="text-center lg:col-span-4 lg:col-start-5">
                  <p className="text-md font-medium">
                    {inference?.title || "What you talkin bout willis"}
                  </p>
                  {inference?.position ? (
                    <p className="text-sm text-muted-foreground">{inference.position}</p>
                  ) : null}
                </div>
                <div className="hidden lg:block lg:col-span-4" />
              </div>
            </div>
          </header>
        ) : null}
        <div className="mx-auto h-full max-w-6xl px-4 sm:px-4 lg:px-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div
              ref={scrollRef}
              className="relative h-[calc(100dvh-180px)] sm:h-[calc(100dvh-200px)] overflow-y-auto pt-8 pb-32 lg:col-span-12 flex justify-center"
            >
              {!hasMessages ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Sin Spoilers</h1>
                    <p className="mt-2 text-sm text-muted-foreground">This is not the bot you&apos;re looking for 🤚</p>
                  </div>
                </div>
              ) : null}
              <div className="flex flex-col gap-6 w-full max-w-full lg:max-w-[60%]">
                {messages.map((m) => (
                  <MessageBubble key={m.id} role={m.role} content={m.content} />
                ))}
                {isStreaming && !messages.find((m) => m.id === "__stream") ? (
                  <MessageBubble role="assistant" content={"▍"} />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </main>

      <div className="sticky bottom-0 w-full bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-6xl px-4 pb-8 pt-4 sm:px-6 lg:px-8">
          <div className="py-3 sm:py-4">
            <div className="flex justify-center">
              <div className="flex gap-2 rounded-2xl border bg-secondary/50 px-3 py-2 lg:col-span-12 w-full max-w-full lg:max-w-[60%]">
                <textarea
                  ref={textAreaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    autoResizeTextArea();
                  }}
                  onInput={autoResizeTextArea}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="Escribe un mensaje..."
                  className="max-h-40 w-full resize-none bg-transparent p-2 text-base outline-none placeholder:text-muted-foreground"
                />

                <button
                  type="button"
                  onClick={() => setDangerMode((v) => !v)}
                  className="cursor-pointer inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white hover:bg-red-800 micro-shake"
                  aria-pressed={dangerMode}
                  aria-label="Toggle danger mode for videogames"
                  title="Danger Mode (videogames only)"
                >
                  <span role="img" aria-label="controller">🎮</span>
                </button>

                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={!input.trim() || isLoading}
                  className="cursor-pointer inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background hover:opacity-90 disabled:opacity-50"
                  aria-label="Enviar"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
              <div className="hidden lg:block lg:col-span-0" />
            </div>
          </div>
          <p className="mt-2 px-1 text-center text-[11px] text-muted-foreground">
            Danger mode can be dangerous
          </p>
        </div>
      </div>
    </div>
  );
}

function formatMediaType(t?: string) {
  if (!t) return "—";
  const map: Record<string, string> = {
    movie: "Movie",
    series: "TV Series",
    anime: "Anime",
    book: "Book",
    videogame: "Videogame",
  };
  const key = (t || "").toLowerCase();
  return map[key] || t;
}

function MessageBubble({ role, content }: { role: "user" | "assistant" | "system"; content: string }) {
  const isUser = role === "user";
  return (
    <div className="sm:gap-4">
      <div
        className={`${isUser
            ? "ml-auto bg-secondary text-secondary-foreground rounded-2xl px-4 py-3 w-fit align-end max-w-[30rem]"
            : "mr-auto bg-transparent px-0 py-0"
          } whitespace-pre-wrap`}
      >
        {content}
      </div>
    </div>
  );
}
