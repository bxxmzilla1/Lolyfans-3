"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SendToTelegram from "./SendToTelegram";
import TelegramReceipt from "./TelegramReceipt";
import { uploadWithProgress } from "@/lib/uploadWithProgress";
import { IconBack, IconPlay, IconSend } from "./Icons";

type TgMessage = {
  id: number;
  text: string;
  out: boolean;
  date: number;
  hasMedia: boolean;
  mediaKind: "image" | "video" | "other" | null;
  receipt: "sent" | "read" | null;
};

/**
 * Creator view of one Telegram dialog: replies, read receipts, and PPV by
 * dragging vault media (or dropping a file) into the chat to set a price.
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
  const [dragOver, setDragOver] = useState(false);
  const [uploadingDrop, setUploadingDrop] = useState(false);
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
            receipt: "sent",
          },
        ]);
        // Refresh soon so real ids + receipts sync from Telegram.
        setTimeout(() => void load(), 1500);
      } else {
        setError(data.error || "Could not send");
      }
    } catch {
      setError("Could not send");
    } finally {
      setSending(false);
    }
  }

  function openPpv(path: string, mediaType: "image" | "video") {
    setVaultPick({ path, media_type: mediaType });
  }

  function onDragOver(e: React.DragEvent) {
    const types = Array.from(e.dataTransfer.types);
    if (
      types.includes("application/x-lolyfans-vault") ||
      types.includes("Files")
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  }

  function onDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);

    const vaultRaw = e.dataTransfer.getData("application/x-lolyfans-vault");
    if (vaultRaw) {
      try {
        const data = JSON.parse(vaultRaw) as { path?: string; type?: string };
        if (
          data.path &&
          (data.type === "image" || data.type === "video")
        ) {
          openPpv(data.path, data.type);
          return;
        }
      } catch {
        // fall through
      }
    }

    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      setError("Drop a photo or video to send as PPV");
      return;
    }

    setUploadingDrop(true);
    setError("");
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, scope: "vault" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.path || !data.signedUrl) {
        setError(data.error || "Could not upload file");
        return;
      }
      await uploadWithProgress(data.signedUrl, file);
      openPpv(String(data.path), isVideo ? "video" : "image");
    } catch {
      setError("Could not upload file");
    } finally {
      setUploadingDrop(false);
    }
  }

  function mediaSrc(messageId: number) {
    return `/api/telegram/media?peer=${encodeURIComponent(peer)}&id=${messageId}`;
  }

  return (
    <div
      className="flex flex-col h-full min-h-0 relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => void onDrop(e)}
    >
      {dragOver && (
        <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center bg-accent/15 border-2 border-dashed border-accent m-2 rounded-2xl">
          <p className="bg-card border border-line rounded-xl px-4 py-2 text-sm font-semibold shadow-lg">
            Drop to set PPV price
          </p>
        </div>
      )}

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
          <p className="text-[11px] text-muted truncate">
            Telegram · drag media from vault to send PPV
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {uploadingDrop ? (
          <p className="text-center text-sm text-muted py-10">Uploading…</p>
        ) : messages === null ? (
          <p className="text-center text-sm text-muted py-10">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-muted py-10">
            No recent messages. Drag a photo or video from the vault to send a
            PPV.
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
                {m.hasMedia &&
                  (m.mediaKind === "image" ||
                    m.mediaKind === "video" ||
                    m.mediaKind === "other") && (
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
                {(m.text || m.out) && (
                  <div className="px-3.5 py-2 flex items-end gap-1.5">
                    {m.text ? (
                      <p className="whitespace-pre-wrap break-words flex-1 min-w-0">
                        {m.text}
                      </p>
                    ) : (
                      <span className="flex-1" />
                    )}
                    {m.out && (
                      <TelegramReceipt
                        receipt={m.receipt}
                        className={
                          m.receipt === "read"
                            ? "!text-sky-200"
                            : "!text-white/70"
                        }
                      />
                    )}
                  </div>
                )}
                {!m.text && m.hasMedia && m.out && (
                  <div className="px-3 pb-1.5 flex justify-end">
                    <TelegramReceipt
                      receipt={m.receipt}
                      className={
                        m.receipt === "read"
                          ? "!text-sky-200"
                          : "!text-white/70"
                      }
                    />
                  </div>
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
