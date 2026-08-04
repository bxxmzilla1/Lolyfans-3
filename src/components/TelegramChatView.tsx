"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EmojiQuickBar from "./EmojiQuickBar";
import SendToTelegram from "./SendToTelegram";
import TelegramReceipt from "./TelegramReceipt";
import VoiceNotePlayer from "./VoiceNotePlayer";
import { uploadWithProgress } from "@/lib/uploadWithProgress";
import {
  IconArchive,
  IconBack,
  IconMic,
  IconPlay,
  IconReply,
  IconSend,
} from "./Icons";

type TgMessage = {
  id: number;
  text: string;
  out: boolean;
  date: number;
  hasMedia: boolean;
  mediaKind: "image" | "video" | "gif" | "sticker" | "voice" | "other" | null;
  receipt: "sent" | "read" | null;
  /** PPV teaser state: "paid" turns the bubble green. */
  ppv?: "paid" | "pending" | null;
  /** Message id this one replies to (renders the quoted strip). */
  replyToId?: number | null;
};

/** One-line description of a message for quote strips. */
function messageSnippet(m: TgMessage | undefined | null): string {
  if (!m) return "Message";
  if (m.text) return m.text.length > 80 ? `${m.text.slice(0, 80)}…` : m.text;
  if (m.mediaKind === "image") return "📷 Photo";
  if (m.mediaKind === "video") return "🎬 Video";
  if (m.mediaKind === "gif") return "GIF";
  if (m.mediaKind === "sticker") return "Sticker";
  if (m.mediaKind === "voice") return "🎤 Voice message";
  if (m.hasMedia) return "Media";
  return "Message";
}

/** Base64 for the generated audio (chunked — big notes overflow the stack). */
function b64FromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

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
  const [archiving, setArchiving] = useState(false);
  const [vaultPick, setVaultPick] = useState<{
    path: string;
    media_type: "image" | "video";
  } | null>(null);
  const [replyTo, setReplyTo] = useState<TgMessage | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function insertEmoji(emoji: string) {
    setText((prev) => `${prev}${emoji}`);
    inputRef.current?.focus();
  }

  function startReply(m: TgMessage) {
    setReplyTo(m);
    inputRef.current?.focus();
  }

  // ---- AI voice notes: type text, mic turns it into an ElevenLabs voice ----
  const [voiceNote, setVoiceNote] = useState<{ url: string; b64: string } | null>(
    null
  );
  const [voiceBusy, setVoiceBusy] = useState<"generating" | "sending" | null>(
    null
  );

  const cancelVoice = useCallback(() => {
    setVoiceNote((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  // Switching chats drops any voice preview in progress.
  useEffect(() => cancelVoice(), [peer, cancelVoice]);

  async function generateVoice() {
    const body = text.trim();
    if (!body || voiceBusy) return;
    setVoiceBusy("generating");
    setError("");
    try {
      const res = await fetch("/api/voice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not generate the voice note");
        return;
      }
      const buf = await res.arrayBuffer();
      const b64 = b64FromBuffer(buf);
      const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
      setVoiceNote((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url, b64 };
      });
    } catch {
      setError("Could not generate the voice note");
    } finally {
      setVoiceBusy(null);
    }
  }

  async function sendVoice() {
    if (!voiceNote || voiceBusy) return;
    setVoiceBusy("sending");
    setError("");
    const replyToId = replyTo?.id ?? null;
    try {
      const res = await fetch("/api/telegram/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peer, audioB64: voiceNote.b64, replyToId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        cancelVoice();
        setText("");
        setReplyTo(null);
        // Refresh so the sent voice bubble appears with its real id.
        setTimeout(() => void load(), 1500);
      } else {
        setError(data.error || "Could not send the voice note");
      }
    } catch {
      setError("Could not send the voice note");
    } finally {
      setVoiceBusy(null);
    }
  }

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
    setReplyTo(null);
    void load();
    // 6s keeps the PPV bubble state (green when bought) moving in step with
    // the vault's 5s status poll, so a double-tap purchase shows up in both
    // at effectively the same time.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 6000);
    return () => clearInterval(timer);
  }, [load]);

  // First paint of a chat lands directly on the newest bubble (no slow
  // scroll down from the top); later refreshes only glide when new
  // messages actually arrived.
  const lastMsgKeyRef = useRef<string>("");
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    const last = messages[messages.length - 1];
    const key = `${peer}:${last.id}`;
    if (lastMsgKeyRef.current === key) return;
    const firstPaint = !lastMsgKeyRef.current.startsWith(`${peer}:`);
    lastMsgKeyRef.current = key;
    bottomRef.current?.scrollIntoView({
      behavior: firstPaint ? "instant" : "smooth",
      block: "end",
    });
  }, [messages, peer]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    const replyToId = replyTo?.id ?? null;
    try {
      const res = await fetch("/api/telegram/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peer, text: body, replyToId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setText("");
        setReplyTo(null);
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
            replyToId,
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

  async function archive() {
    if (archiving) return;
    setArchiving(true);
    setError("");
    try {
      const res = await fetch("/api/telegram/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peer, archived: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push("/inbox");
      } else {
        setError(data.error || "Could not archive");
      }
    } catch {
      setError("Could not archive");
    } finally {
      setArchiving(false);
    }
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
            Drop to send — set a price or send free
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
        <button
          type="button"
          onClick={() => void archive()}
          disabled={archiving}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line text-muted hover:text-fg text-xs font-semibold disabled:opacity-50"
          title="Archive this chat (hides it from the inbox)"
        >
          <IconArchive className="w-4 h-4" />
          {archiving ? "Archiving…" : "Archive"}
        </button>
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
              className={`group flex items-center gap-1.5 ${
                m.out ? "justify-end" : "justify-start"
              }`}
            >
              {m.out && (
                <button
                  type="button"
                  onClick={() => startReply(m)}
                  aria-label="Reply to this message"
                  title="Reply"
                  className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted/50 hover:text-accent hover:bg-card2 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                >
                  <IconReply className="w-4 h-4" />
                </button>
              )}
              <div
                className={`max-w-[80%] rounded-2xl overflow-hidden text-sm ${
                  m.out
                    ? `${
                        m.ppv === "paid" ? "bg-green-600" : "bg-accent"
                      } text-white rounded-br-md`
                    : "bg-card2 border border-line rounded-bl-md"
                }`}
              >
                {m.replyToId ? (
                  <div
                    className={`mx-2 mt-2 px-2.5 py-1.5 rounded-lg border-l-2 text-xs truncate ${
                      m.out
                        ? "bg-white/15 border-white/60 text-white/85"
                        : "bg-accent/10 border-accent text-muted"
                    }`}
                  >
                    ↩{" "}
                    {messageSnippet(
                      messages.find((x) => x.id === m.replyToId)
                    )}
                  </div>
                ) : null}
                {m.hasMedia && m.mediaKind === "sticker" && (
                  <div className="p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaSrc(m.id)}
                      alt="Sticker"
                      className="w-36 h-36 object-contain"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                )}
                {m.hasMedia && m.mediaKind === "voice" && (
                  <div className="px-3 pt-2.5 pb-1 w-64 max-w-full">
                    <VoiceNotePlayer src={mediaSrc(m.id)} onAccent={m.out} />
                  </div>
                )}
                {m.hasMedia && m.mediaKind === "gif" && (
                  <div className="relative bg-black/20">
                    <video
                      src={mediaSrc(m.id)}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      className="w-full max-h-72 object-cover"
                    />
                  </div>
                )}
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
              {!m.out && (
                <button
                  type="button"
                  onClick={() => startReply(m)}
                  aria-label="Reply to this message"
                  title="Reply"
                  className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted/50 hover:text-accent hover:bg-card2 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                >
                  <IconReply className="w-4 h-4" />
                </button>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="px-4 pb-1 text-xs text-red-400 text-center">{error}</p>
      )}

      {replyTo && (
        <div className="border-t border-line px-3 py-2 flex items-center gap-2 bg-card/60 shrink-0">
          <IconReply className="w-4 h-4 text-accent shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-accent">
              Replying to {replyTo.out ? "yourself" : title}
            </p>
            <p className="text-xs text-muted truncate">
              {messageSnippet(replyTo)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            aria-label="Cancel reply"
            className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-fg text-base leading-none"
          >
            ×
          </button>
        </div>
      )}

      {/* Voice note preview — takes the emoji bar's slot while active. The
          composer buttons drive it: mic regenerates, send sends, × cancels. */}
      {voiceNote && (
        <div
          className={`${replyTo ? "" : "border-t border-line "}px-3 py-2 flex items-center gap-2.5 shrink-0 bg-accent/10`}
        >
          <IconMic className="w-4 h-4 text-accent shrink-0" />
          <VoiceNotePlayer src={voiceNote.url} />
        </div>
      )}

      {/* Emoji quick-bar (shared with the PPV send sheet). */}
      {!voiceNote && (
        <EmojiQuickBar
          onInsert={insertEmoji}
          className={`${replyTo ? "" : "border-t border-line "}shrink-0 bg-card/40`}
        />
      )}

      <div className="border-t border-line p-3 flex items-end gap-2 shrink-0 pb-[max(12px,env(safe-area-inset-bottom))]">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              // In voice mode Enter sends the previewed voice note (the mic
              // button regenerates).
              if (voiceNote) void sendVoice();
              else void send();
            }
          }}
          rows={1}
          placeholder={
            voiceNote
              ? "Enter sends the voice note · mic regenerates"
              : replyTo
              ? "Reply to the selected message…"
              : "Reply on Telegram…"
          }
          className="flex-1 bg-card2 border border-line rounded-2xl px-4 py-2.5 text-sm placeholder:text-muted focus:border-accent outline-none resize-none max-h-28"
        />
        {voiceNote && (
          <button
            type="button"
            onClick={cancelVoice}
            disabled={voiceBusy === "sending"}
            aria-label="Cancel voice note"
            title="Cancel and go back to text"
            className="w-11 h-11 rounded-full bg-card2 border border-line text-muted hover:text-fg flex items-center justify-center disabled:opacity-40 text-xl leading-none"
          >
            ×
          </button>
        )}
        <button
          type="button"
          onClick={() => void generateVoice()}
          disabled={voiceBusy !== null || !text.trim()}
          aria-label={voiceNote ? "Regenerate voice note" : "Turn text into a voice note"}
          title={
            voiceNote
              ? "Regenerate the voice note from your text"
              : "Turn your text into an ElevenLabs voice note — add expressions like [giggles], [whispers]"
          }
          className={`w-11 h-11 rounded-full flex items-center justify-center border transition-colors disabled:opacity-40 ${
            voiceNote || voiceBusy === "generating"
              ? "bg-accent border-accent text-white"
              : "bg-card2 border-line text-muted hover:text-accent hover:border-accent"
          } ${voiceBusy === "generating" ? "animate-pulse" : ""}`}
        >
          <IconMic className="w-4.5 h-4.5" />
        </button>
        <button
          type="button"
          onClick={() => (voiceNote ? void sendVoice() : void send())}
          disabled={
            voiceNote ? voiceBusy !== null : sending || !text.trim()
          }
          aria-label={voiceNote ? "Send voice note" : "Send"}
          title={voiceNote ? "Send voice note" : undefined}
          className={`w-11 h-11 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-40 ${
            voiceBusy === "sending" ? "animate-pulse" : ""
          }`}
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
