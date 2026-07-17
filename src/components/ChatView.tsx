"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { fileKind, mediaUrl } from "@/lib/utils";
import MessageBubble, { Message } from "./MessageBubble";
import LinkPopup from "./LinkPopup";

export default function ChatView({
  chatId,
  role,
  header,
}: {
  chatId: string;
  role: "owner" | "guest";
  header: React.ReactNode;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [popupUrl, setPopupUrl] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/messages?chatId=${chatId}`);
    if (res.ok) {
      const { messages } = await res.json();
      setMessages(messages);
    }
  }, [chatId]);

  useEffect(() => {
    load();
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`chat:${chatId}`)
      .on("broadcast", { event: "new-message" }, ({ payload }) => {
        setMessages((prev) =>
          prev.some((m) => m.id === (payload as Message).id)
            ? prev
            : [...prev, payload as Message]
        );
      })
      .subscribe();

    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
    };
  }, [chatId, load]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  async function send(mediaPath?: string, mediaType?: string) {
    const content = text.trim();
    if (!content && !mediaPath) return;
    setSending(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          content,
          mediaPath,
          mediaType,
          replyToId: replyTo?.id,
        }),
      });
      if (res.ok) {
        const { message } = await res.json();
        setMessages((prev) =>
          prev.some((m) => m.id === message.id) ? prev : [...prev, message]
        );
        setText("");
        setReplyTo(null);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleFile(file: File) {
    const kind = fileKind(file);
    if (!kind) return;
    setUploading(true);
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, scope: "chat" }),
      });
      if (!res.ok) return;
      const { path, token } = await res.json();
      const { error } = await supabaseBrowser()
        .storage.from("media")
        .uploadToSignedUrl(path, token, file);
      if (!error) await send(path, kind);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const byId = new Map(messages.map((m) => [m.id, m]));

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      {header}

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-16 h-16 rounded-full ig-gradient flex items-center justify-center text-3xl">
              💬
            </div>
            <p className="text-muted text-sm">No messages yet. Say hi!</p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            mine={m.sender === role}
            repliedTo={m.reply_to_id ? byId.get(m.reply_to_id) ?? null : null}
            onReply={setReplyTo}
            onLinkClick={setPopupUrl}
            onMediaClick={setLightbox}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {replyTo && (
        <div className="mx-3 mb-1 px-3 py-2 rounded-xl bg-card2 border border-line flex items-center gap-2 fade-up">
          <div className="w-1 self-stretch rounded ig-gradient shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-accent">
              Replying to {replyTo.sender === role ? "yourself" : "them"}
            </p>
            <p className="text-xs text-muted truncate">
              {replyTo.content ||
                (replyTo.media_type === "image" ? "📷 Photo" : "🎬 Video")}
            </p>
          </div>
          <button
            onClick={() => setReplyTo(null)}
            className="text-muted text-sm px-1"
            aria-label="Cancel reply"
          >
            ✕
          </button>
        </div>
      )}

      <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2 bg-card2 border border-line rounded-3xl px-2 py-1.5">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-9 h-9 rounded-full ig-gradient text-white text-lg shrink-0 disabled:opacity-50 flex items-center justify-center"
            aria-label="Attach media"
          >
            {uploading ? (
              <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            ) : (
              "+"
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message…"
            rows={1}
            className="flex-1 bg-transparent resize-none max-h-32 py-2 text-[15px] placeholder:text-muted"
          />
          <button
            onClick={() => send()}
            disabled={sending || !text.trim()}
            className="px-4 py-2 text-accent font-semibold text-sm disabled:opacity-40 shrink-0"
          >
            Send
          </button>
        </div>
      </div>

      {popupUrl && <LinkPopup url={popupUrl} onClose={() => setPopupUrl(null)} />}

      {lightbox && lightbox.media_path && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mediaUrl(lightbox.media_path)}
            alt="Photo"
            className="max-w-full max-h-full rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
}
