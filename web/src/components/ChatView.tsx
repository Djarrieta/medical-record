import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";
import { askChat, rawUrl } from "../api";
import { IconChat, IconSend } from "../icons";

export function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async () => {
    const question = input.trim();
    if (!question || busy) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setBusy(true);
    const reply = await askChat(question);
    setBusy(false);
    if (!reply.ok) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply.error || "No se pudo responder." },
      ]);
      return;
    }
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: reply.answer || "",
        sources: reply.documents,
      },
    ]);
  };

  return (
    <section className="card chat-card">
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && !busy ? (
          <div className="chat-empty">
            <span className="chat-empty-ico" aria-hidden="true">
              <IconChat />
            </span>
            <strong>Pregúntale a tu expediente</strong>
            <span>
              Hazme preguntas sobre tus documentos clínicos. Por ejemplo: “¿cuál fue mi último valor
              de glucosa?”.
            </span>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={"bubble bubble-" + m.role}>
              <div className="bubble-text">{m.content}</div>
              {m.sources && m.sources.length > 0 && (
                <div className="bubble-sources">
                  {m.sources.map((s) => (
                    <a
                      key={s.id}
                      href={rawUrl(s.id, false)}
                      target="_blank"
                      rel="noreferrer"
                      className="src-chip"
                    >
                      {s.name}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
        {busy && (
          <div className="bubble bubble-assistant">
            <div className="typing" aria-label="Escribiendo">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          rows={1}
          placeholder="Escribe tu pregunta…"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          className="btn btn-primary chat-send"
          disabled={busy || !input.trim()}
          aria-label="Enviar"
        >
          <IconSend />
        </button>
      </form>
    </section>
  );
}
