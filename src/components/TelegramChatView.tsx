"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SendToTelegram from "./SendToTelegram";
import Portal from "./Portal";
import { mediaUrl } from "@/lib/utils";
import { IconBack, IconSend } from "./Icons";

type TgMessage = {
  id: number;
  text: string;
  out: boolean;
  date: number;
  hasMedia: boolean;
};

type VaultItem = {
  path: string;
  media_type: "image" | "video";
};

/**
 * Creator view of one Telegram dialog: read recent messages, reply in plain
 * text, and send a locked PPV from the vault into this chat.
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
  const [vaultPick, setVaultPick] = useState<VaultItem | null>(null);
  const [vaultItems, setVaultItems] = useState<VaultItem[] | null>(null);
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

  async function openPpvPicker() {
    setPpvOpen(true);
    if (vaultItems) return;
    try {
      const res = await fetch("/api/vault/items");
      const data = await res.json().catch(() => ({}));
      const items = (data.items ?? []) as Array<{
        media_path?: string;
        media_type?: string;
      }>;
      setVaultItems(
        items
          .map((i) => ({
            path: String(i.media_path || ""),
            media_type: (i.media_type === "video" ? "video" : "image") as
              | "image"
              | "video",
          }))
          .filter((i) => i.path)
      );
    } catch {
      setVaultItems([]);
    }
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
          onClick={() => void openPpvPicker()}
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
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                  m.out
                    ? "bg-accent text-white rounded-br-md"
                    : "bg-card2 border border-line rounded-bl-md"
                }`}
              >
                {m.text || (m.hasMedia ? "📎 Media" : "")}
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
          <div
            className="fixed inset-0 z-[70] bg-black/70 flex items-end sm:items-center justify-center p-4"
            onClick={() => setPpvOpen(false)}
          >
            <div
              className="w-full max-w-md bg-card border border-line rounded-2xl p-4 space-y-3 fade-up max-h-[80dvh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <p className="font-bold text-sm">Pick vault media</p>
                <button
                  type="button"
                  onClick={() => setPpvOpen(false)}
                  className="text-muted text-sm px-1"
                >
                  ✕
                </button>
              </div>
              {vaultItems === null ? (
                <p className="text-sm text-muted text-center py-6">Loading…</p>
              ) : vaultItems.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <p className="text-sm text-muted">Vault is empty.</p>
                  <Link
                    href="/vault"
                    className="text-sm font-semibold text-accent"
                  >
                    Open Vault
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {vaultItems.map((item) => (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => {
                        setVaultPick(item);
                        setPpvOpen(false);
                      }}
                      className="aspect-square rounded-xl overflow-hidden bg-card2 border border-line"
                    >
                      {item.media_type === "video" ? (
                        <video
                          src={`${mediaUrl(item.path)}#t=0.001`}
                          muted
                          playsInline
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={mediaUrl(item.path)}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
