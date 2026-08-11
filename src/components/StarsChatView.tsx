"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { mediaUrl } from "@/lib/utils";
import { IconBack, IconLock, IconSend, IconStar } from "./Icons";
import SendStarsPpv from "./SendStarsPpv";

type Msg = {
  id: string;
  sender: "owner" | "fan";
  content: string | null;
  media_path: string | null;
  media_type: string | null;
  locked: boolean;
  price_stars: number;
  status: string;
  unlock_id: string | null;
  created_at: string;
};

export default function StarsChatView({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [ppvOpen, setPpvOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/stars/messages?chatId=${encodeURIComponent(chatId)}`
    );
    if (!res.ok) return;
    const data = await res.json();
    setMessages(data.messages ?? []);
  }, [chatId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendText() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/stars/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, content: text.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not send");
        return;
      }
      setText("");
      if (data.message) setMessages((m) => [...m, data.message]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-line px-3 py-2.5 flex items-center gap-3 bg-card/60 backdrop-blur-lg">
        <Link href="/inbox" className="lg:hidden text-fg p-1" aria-label="Back">
          <IconBack className="w-5 h-5" />
        </Link>
        <div className="w-9 h-9 rounded-full bg-amber-500/20 flex items-center justify-center">
          <IconStar className="w-5 h-5 text-amber-400" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-[15px] truncate">{title}</p>
          <p className="text-xs text-amber-400/80">Stars Mini App chat</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.map((m) => {
          const mine = m.sender === "owner";
          return (
            <div
              key={m.id}
              className={`flex ${mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  mine
                    ? m.locked
                      ? "bg-amber-500/20 border border-amber-500/40"
                      : m.status === "paid"
                      ? "bg-emerald-500/20 border border-emerald-500/40"
                      : "bg-accent text-white"
                    : "bg-card2 border border-line"
                }`}
              >
                {m.locked && (
                  <p className="text-xs font-semibold text-amber-300 flex items-center gap-1 mb-1">
                    <IconLock className="w-3.5 h-3.5" />
                    {m.price_stars} Stars · waiting
                  </p>
                )}
                {m.status === "paid" && m.media_path && (
                  <p className="text-xs font-semibold text-emerald-300 mb-1">
                    Unlocked
                  </p>
                )}
                {m.media_path && !m.locked && m.media_type === "video" && (
                  <video
                    src={mediaUrl(m.media_path)}
                    controls
                    className="rounded-xl max-w-full max-h-64 mb-1"
                  />
                )}
                {m.media_path && !m.locked && m.media_type !== "video" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(m.media_path)}
                    alt=""
                    className="rounded-xl max-w-full max-h-64 mb-1"
                  />
                )}
                {m.media_path && m.locked && (
                  <div className="relative w-40 h-28 rounded-xl overflow-hidden bg-black/40 flex items-center justify-center mb-1">
                    {m.unlock_id && (
                      // Same blurred still the fan sees while it's locked.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/stars/teaser/${m.unlock_id}`}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        draggable={false}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                    )}
                    <span className="absolute inset-0 bg-black/30" />
                    <IconLock className="relative w-8 h-8 text-amber-400 drop-shadow" />
                  </div>
                )}
                {m.content && (
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="px-4 text-xs text-red-400 text-center">{error}</p>
      )}

      <div className="shrink-0 border-t border-line p-3 space-y-2 bg-card/40">
        <button
          type="button"
          onClick={() => setPpvOpen(true)}
          className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs font-bold py-2 flex items-center justify-center gap-1.5"
        >
          <IconStar className="w-3.5 h-3.5" /> Send PPV for Stars
        </button>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void sendText()}
            placeholder="Message…"
            className="flex-1 rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void sendText()}
            disabled={sending || !text.trim()}
            className="w-11 h-11 rounded-xl bg-accent text-white flex items-center justify-center disabled:opacity-40"
          >
            <IconSend className="w-5 h-5" />
          </button>
        </div>
      </div>

      {ppvOpen && (
        <SendStarsPpv
          chatId={chatId}
          onClose={() => setPpvOpen(false)}
          onSent={(msg) => {
            setMessages((m) => [...m, msg]);
            setPpvOpen(false);
          }}
        />
      )}
    </div>
  );
}
