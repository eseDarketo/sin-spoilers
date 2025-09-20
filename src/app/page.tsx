"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, User } from "lucide-react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    // Placeholder assistant echo to show the active state. We'll replace with API later.
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: "(assistant response goes here)" },
      ]);
    }, 300);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1">
        <div className="mx-auto h-full max-w-3xl px-4 sm:px-6 lg:px-8">
          <div
            ref={scrollRef}
            className="relative h-[calc(100dvh-180px)] sm:h-[calc(100dvh-200px)] overflow-y-auto pt-8 pb-32"
          >
            {!hasMessages ? (
              <div className="pointer-events-none absolute inset-0 flex items-start justify-center">
                <div className="mt-24 text-center">
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Sin Spoilers</h1>
                  <p className="mt-2 text-sm text-muted-foreground">This is not the bot you're looking for</p>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-6">
              {messages.map((m) => (
                <MessageBubble key={m.id} role={m.role} content={m.content} />
              ))}
            </div>
          </div>
        </div>
      </main>

      <div className="sticky bottom-0 w-full border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="py-3 sm:py-4">
            <div className="flex items-end gap-2 rounded-2xl border bg-secondary/50 px-3 py-2">
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
                onClick={onSubmit}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background hover:opacity-90"
                aria-label="Enviar"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 px-1 text-center text-[11px] text-muted-foreground">
              Al enviar un mensaje aceptas nuestros Términos y Política de privacidad.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className="grid grid-cols-[auto_1fr] items-start gap-3 sm:gap-4">
      <div
        className={`${
          isUser ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
        } h-8 w-8 rounded-full flex items-center justify-center`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={`${
          isUser ? "bg-primary text-primary-foreground" : "bg-secondary"
        } rounded-2xl px-4 py-3 whitespace-pre-wrap`}
      >
        {content}
      </div>
    </div>
  );
}
