"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SendToTelegram from "./SendToTelegram";
import Portal from "./Portal";
import { VaultPicker, type VaultItem } from "./MassMessage";
import { IconBack, IconPlay, IconSend } from "./Icons";

type TgMessage = {
  id: number;
  text: string;
  out: boolean;
  date: number;
  hasMedia: boolean;
  mediaKind: "image" | "video" | "other" | null;
};

/**
 * Creator view of one Telegram dialog: read recent messages (with media
 * thumbs), reply in plain text, and send a locked PPV from vault albums.
 */
export default function TelegramChatView({
  peer,
  title,
}: {
  peer: string;
  title: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<TgMessage[] | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [ppvOpen, setPpvOpen] = useState(false);
  const [vaultPick, setVaultPick] = useState<{
    path: string;
    media_type: "image" | "video";
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/telegram/messages?peer=${encodeURIComponent(peer)}`
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessages(data.messages ?? []);
        setError("");
      } else {
        setError(data.error || "Could not load messages");
      }
    } catch {
      setError("Could not load messages");
    }
  }, [peer]);

  useEffect(() => {
    setMessages(null);
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 12000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/telegram/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peer, text: body }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setText("");
        setMessages((prev) => [
          ...(prev ?? []),
          {
            id: Date.now(),
            text: body,
            out: true,
            date: Math.floor(Date.now() / 1000),
            hasMedia: false,
            mediaKind: null,
          },
        ]);
      } else {
        setError(data.error || "Could not send");
      }
    } catch {
      setError("Could not send");
    } finally {
      setSending(false);
    }
  }

  function mediaSrc(messageId: number) {
    return `/api/telegram/media?peer=${encodeURIComponent(peer)}&id=${messageId}`;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="border-b border-line2 px-3 py-3 flex items-center gap-2 bg-card/60 backdrop-blur-lg shrink-0">
        <button
          type="button"
          onClick={() => router.push("/inbox")}
          className="lg:hidden w-9 h-9 rounded-full flex items-center justify-center text-muted"
          aria-label="Back"
        >
          <IconBack className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[15px] truncate">{title}</p>
          <p className="text-[11px] text-muted truncate">Telegram</p>
        </div>
        <button
          type="button"
          onClick={() => setPpvOpen(true)}
          className="shrink-0 px-3 py-1.5 rounded-full bg-accent text-white text-xs font-semibold"
        >
          Send PPV
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {messages === null ? (
          <p className="text-center text-sm text-muted py-10">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-muted py-10">
            No recent messages in this chat.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.out ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl overflow-hidden text-sm ${
                  m.out
                    ? "bg-accent text-white rounded-br-md"
                    : "bg-card2 border border-line rounded-bl-md"
                }`}
              >
                {m.hasMedia && (m.mediaKind === "image" || m.mediaKind === "video" || m.mediaKind === "other") && (
                  <div className="relative bg-black/20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaSrc(m.id)}
                      alt=""
                      className="w-full max-h-72 object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    {m.mediaKind === "video" && (
                      <span className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-black/50 flex items-center justify-center pointer-events-none">
                        <IconPlay className="w-4 h-4 text-white translate-x-px" />
                      </span>
                    )}
                  </div>
                )}
                {m.text ? (
                  <p className="px-3.5 py-2 whitespace-pre-wrap break-words">
                    {m.text}
                  </p>
                ) : m.hasMedia ? null : (
                  <p className="px-3.5 py-2 text-muted"> </p>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="px-4 pb-1 text-xs text-red-400 text-center">{error}</p>
      )}

      <div className="border-t border-line p-3 flex items-end gap-2 shrink-0 pb-[max(12px,env(safe-area-inset-bottom))]">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Reply on Telegram…"
          className="flex-1 bg-card2 border border-line rounded-2xl px-4 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none resize-none max-h-28"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          aria-label="Send"
          className="w-11 h-11 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-40"
        >
          <IconSend className="w-4.5 h-4.5" />
        </button>
      </div>

      {ppvOpen && !vaultPick && (
        <Portal>
          <div className="fixed inset-0 z-[70]">
            <VaultPicker
              onPick={(item: VaultItem) => {
                setVaultPick({
                  path: item.media_path,
                  media_type: item.media_type,
                });
                setPpvOpen(false);
              }}
              onClose={() => setPpvOpen(false)}
            />
          </div>
        </Portal>
      )}

      {vaultPick && (
        <SendToTelegram
          mediaPath={vaultPick.path}
          mediaType={vaultPick.media_type}
          initialPeer={peer}
          peerLabel={title}
          onClose={() => {
            setVaultPick(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
