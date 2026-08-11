"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/utils";
import { IconLock, IconSend, IconStar } from "./Icons";

type Msg = {
  id: string;
  sender: "owner" | "fan";
  content: string | null;
  media_path: string | null;
  media_type: string | null;
  locked: boolean;
  price_stars: number;
  status: string;
  media_locked?: boolean;
  unlock_id: string | null;
  created_at: string;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand: () => void;
        openInvoice: (
          url: string,
          callback?: (status: string) => void
        ) => void;
        themeParams?: Record<string, string>;
        colorScheme?: string;
      };
    };
  }
}

export default function StarsMiniApp({ ownerId }: { ownerId: string }) {
  const [initData, setInitData] = useState("");
  const [ownerName, setOwnerName] = useState("Creator");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(
    async (id: string) => {
      const q = new URLSearchParams({ ownerId, initData: id });
      const res = await fetch(`/api/stars/app/messages?${q}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setMessages(data.messages ?? []);
    },
    [ownerId]
  );

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.onload = () => {
      const wa = window.Telegram?.WebApp;
      wa?.ready();
      wa?.expand();
      const raw = wa?.initData || "";
      setInitData(raw);
    };
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);

  useEffect(() => {
    if (!initData) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/stars/app/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerId, initData }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) {
            setError(data.error || "Open this Mini App from Telegram");
          }
          return;
        }
        if (!cancelled) {
          setOwnerName(data.ownerName || "Creator");
          await loadMessages(initData);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initData, ownerId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Poll for new messages / unlocks while the Mini App is open.
  useEffect(() => {
    if (!initData) return;
    const t = setInterval(() => void loadMessages(initData), 2500);
    return () => clearInterval(t);
  }, [initData, loadMessages]);

  // Heartbeat: while this tab is open, creators won't bot-notify "unread".
  // When the fan leaves (closes Mini App), heartbeats stop and the next
  // creator message triggers a Telegram push from the bot.
  useEffect(() => {
    if (!initData) return;
    const ping = () => {
      void fetch("/api/stars/app/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, initData }),
        keepalive: true,
      }).catch(() => {});
    };
    ping();
    const t = setInterval(ping, 20_000);
    const onVis = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [initData, ownerId]);

  async function send() {
    if (!text.trim() || sending || !initData) return;
    setSending(true);
    try {
      const res = await fetch("/api/stars/app/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, initData, content: text.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.message) {
        // The 2.5s poll may have already delivered this row — appending it
        // again would show the message twice until the next poll.
        setMessages((m) =>
          m.some((x) => x.id === data.message.id) ? m : [...m, data.message]
        );
        setText("");
      } else {
        setError(data.error || "Could not send");
      }
    } finally {
      setSending(false);
    }
  }

  async function unlock(msg: Msg) {
    if (!initData || payingId) return;
    setPayingId(msg.id);
    try {
      const res = await fetch("/api/stars/app/messages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, initData, messageId: msg.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.invoiceLink) {
        setError(data.error || "Could not start Stars payment");
        return;
      }
      const wa = window.Telegram?.WebApp;
      if (wa?.openInvoice) {
        wa.openInvoice(data.invoiceLink, (status) => {
          if (status === "paid") void loadMessages(initData);
        });
      } else {
        window.location.href = data.invoiceLink;
      }
    } finally {
      setPayingId(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#0e0e12] text-white/60 text-sm">
        Opening chat…
      </div>
    );
  }

  if (error && messages.length === 0 && !initData) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 bg-[#0e0e12] text-white p-6 text-center">
        <IconStar className="w-8 h-8 text-amber-400" />
        <p className="text-sm text-white/70">
          Open this Mini App from the Telegram bot menu.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col bg-[#0e0e12] text-white">
      <header className="shrink-0 border-b border-white/10 px-4 py-3 flex items-center gap-2">
        <IconStar className="w-5 h-5 text-amber-400" />
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{ownerName}</p>
          <p className="text-[11px] text-white/50">Pay with Telegram Stars</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {error && (
          <p className="text-xs text-red-400 text-center px-2">{error}</p>
        )}
        {messages.length === 0 && (
          <p className="text-center text-white/40 text-sm pt-10">
            Say hi — then unlock PPVs with Stars.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender === "fan";
          const locked = m.locked && m.status !== "paid";
          return (
            <div
              key={m.id}
              className={`flex ${mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  mine
                    ? "bg-sky-600 text-white"
                    : "bg-white/10 text-white"
                }`}
              >
                {locked ? (
                  <button
                    type="button"
                    onClick={() => void unlock(m)}
                    disabled={payingId === m.id}
                    className="relative overflow-hidden rounded-xl flex flex-col items-center justify-center gap-2 py-4 px-6 min-w-[160px] min-h-[140px]"
                  >
                    {m.unlock_id && (
                      // Blurred still of the actual photo/video — never clear.
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
                    <span className="absolute inset-0 bg-black/40" />
                    <span className="relative w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
                      <IconLock className="w-6 h-6 text-amber-400" />
                    </span>
                    <span className="relative font-bold text-amber-300 drop-shadow">
                      {m.price_stars} Stars
                    </span>
                    <span className="relative text-xs text-white/80 drop-shadow">
                      {payingId === m.id ? "Opening…" : "Tap to unlock"}
                    </span>
                  </button>
                ) : (
                  <>
                    {m.media_path && m.media_type === "video" && (
                      <video
                        src={mediaUrl(m.media_path)}
                        controls
                        className="rounded-xl max-w-full max-h-64 mb-1"
                      />
                    )}
                    {m.media_path && m.media_type !== "video" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(m.media_path)}
                        alt=""
                        className="rounded-xl max-w-full max-h-64 mb-1"
                      />
                    )}
                    {m.content && (
                      <p className="whitespace-pre-wrap break-words">
                        {m.content}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-white/10 p-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send()}
          placeholder="Message…"
          className="flex-1 rounded-full bg-white/10 px-4 py-2.5 text-sm outline-none placeholder:text-white/40"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          className="w-11 h-11 rounded-full bg-sky-600 flex items-center justify-center disabled:opacity-40"
        >
          <IconSend className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
