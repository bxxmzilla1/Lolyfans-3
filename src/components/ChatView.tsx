"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { fileKind, mediaUrl, MediaKind, messagePreviewText } from "@/lib/utils";
import MessageBubble, { Message } from "./MessageBubble";
import Portal from "./Portal";
import {
  IconChat,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconLink,
  IconLock,
  IconPlus,
  IconSend,
  IconUnlock,
} from "./Icons";

export default function ChatView({
  chatId,
  role,
  header,
  initialMessages,
}: {
  chatId: string;
  role: "owner" | "guest";
  header: React.ReactNode;
  initialMessages?: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [lightbox, setLightbox] = useState<Message | null>(null);
  const [labelDialog, setLabelDialog] = useState<{ url: string; label: string; price: string } | null>(null);
  const [linkAttachment, setLinkAttachment] = useState<{ url: string; label: string; price: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachment, setAttachment] = useState<{ path: string; type: MediaKind } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sendLocked, setSendLocked] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [msgSelectMode, setMsgSelectMode] = useState(false);
  const [selectedMsgs, setSelectedMsgs] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSentAtRef = useRef(0);

  function applyLinkLabel() {
    if (!labelDialog) return;
    // Label and price are both optional — only the link itself is required.
    const label = labelDialog.label.trim().replace(/[[\]{}]/g, "");
    const price = labelDialog.price.trim().replace(/[^\d.,]/g, "");
    let url = labelDialog.url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    setLinkAttachment({ url, label, price });
    setLabelDialog(null);
  }

  const scrollToBottom = useCallback((smooth = true) => {
    const list = listRef.current;
    if (list) {
      list.scrollTo({ top: list.scrollHeight, behavior: smooth ? "smooth" : "auto" });
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/messages?chatId=${chatId}`);
    if (res.ok) {
      const { messages } = await res.json();
      setMessages(messages);
    }
  }, [chatId]);

  // Jump straight to the latest message when opening a chat (no smooth scroll delay)
  useEffect(() => {
    setMessages(initialMessages ?? []);
    setPeerTyping(false);
    setReplyTo(null);
    setAttachment(null);
    setLinkAttachment(null);
    setMsgSelectMode(false);
    setSelectedMsgs(new Set());
    // Wait a frame so the list has laid out its content
    requestAnimationFrame(() => {
      scrollToBottom(false);
      // Media can push height after load — nudge again shortly after
      setTimeout(() => scrollToBottom(false), 100);
      setTimeout(() => scrollToBottom(false), 400);
    });
  }, [chatId, initialMessages, scrollToBottom]);

  useEffect(() => {
    // Messages are server-rendered; only fetch on mount when none were provided.
    if (!initialMessages) load();
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`chat:${chatId}`)
      .on("broadcast", { event: "new-message" }, ({ payload }) => {
        const msg = payload as Message;
        if (msg.sender !== role) setPeerTyping(false);
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          // Our own message echoed back: replace the optimistic temp bubble
          // instead of appending, so it never shows twice.
          if (msg.sender === role) {
            const tempIdx = prev.findIndex(
              (m) =>
                m.id.startsWith("temp-") &&
                m.content === msg.content &&
                m.media_path === msg.media_path
            );
            if (tempIdx !== -1) {
              const copy = [...prev];
              copy[tempIdx] = msg;
              return copy;
            }
          } else if (role === "owner") {
            // Reading the incoming message right now: mark the chat as read
            // so the sidebar badge doesn't stick around.
            fetch("/api/read", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatId }),
            }).catch(() => {});
          } else {
            // Guest reading the incoming message right now: advance the read
            // cursor immediately so the footer Chats badge stays accurate.
            fetch("/api/guest/ping", { method: "POST" }).catch(() => {});
          }
          return [...prev, msg];
        });
      })
      .on("broadcast", { event: "update-message" }, ({ payload }) => {
        const msg = payload as Message;
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
      })
      .on("broadcast", { event: "hide-messages" }, () => {
        // Refetch: guests get the filtered list, the owner gets updated labels
        load();
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if ((payload as { sender: string }).sender === role) return;
        setPeerTyping(true);
        if (typingHideRef.current) clearTimeout(typingHideRef.current);
        typingHideRef.current = setTimeout(() => setPeerTyping(false), 3000);
      })
      .subscribe();
    channelRef.current = channel;

    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, load]);

  useEffect(() => {
    scrollToBottom(true);
  }, [messages.length, peerTyping, scrollToBottom]);

  /** Let the other side know we're typing (throttled). */
  function notifyTyping() {
    const now = Date.now();
    if (now - typingSentAtRef.current < 1500) return;
    typingSentAtRef.current = now;
    channelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { sender: role },
    });
  }

  async function send(mediaPathArg?: string, mediaTypeArg?: string) {
    const mediaPath = mediaPathArg ?? attachment?.path;
    const mediaType = mediaTypeArg ?? attachment?.type;
    const usedAttachment = !mediaPathArg ? attachment : null;
    const usedLink = !mediaPathArg ? linkAttachment : null;
    const caption = text.trim();
    // The attached link travels inside the message text as [Label]{price}(url)
    // — empty label = hidden link (media becomes the tap target); the caption
    // from the input goes above it.
    const linkPart = usedLink
      ? `[${usedLink.label}]${usedLink.price ? `{${usedLink.price}}` : ""}(${usedLink.url})`
      : "";
    const content = [caption, linkPart].filter(Boolean).join("\n");
    if (!content && !mediaPath) return;
    const locked = sendLocked && !!mediaPath;

    // Optimistic: show the message immediately, reconcile with the server response.
    const tempId = `temp-${Date.now()}`;
    const replyToId = replyTo?.id ?? null;
    const temp: Message = {
      id: tempId,
      chat_id: chatId,
      sender: role,
      content: content || null,
      media_path: mediaPath || null,
      media_type: (mediaType as Message["media_type"]) || null,
      reply_to_id: replyToId,
      locked,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, temp]);
    setText("");
    setReplyTo(null);
    setAttachment(null);
    if (usedLink) setLinkAttachment(null);
    if (locked) setSendLocked(false);

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, content, mediaPath, mediaType, replyToId, locked }),
      });
      if (res.ok) {
        const { message } = await res.json();
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          return withoutTemp.some((m) => m.id === message.id)
            ? withoutTemp
            : [...withoutTemp, message];
        });
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setText(caption);
        if (usedAttachment) setAttachment(usedAttachment);
        if (usedLink) setLinkAttachment(usedLink);
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(caption);
      if (usedAttachment) setAttachment(usedAttachment);
      if (usedLink) setLinkAttachment(usedLink);
    }
  }

  async function toggleLock(message: Message) {
    const next = !message.locked;
    // Optimistic flip; the broadcast confirms it for everyone.
    setMessages((prev) =>
      prev.map((m) => (m.id === message.id ? { ...m, locked: next } : m))
    );
    const res = await fetch("/api/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: message.id, locked: next }),
    });
    if (!res.ok) {
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, locked: message.locked } : m))
      );
    }
  }

  function toggleMsgSelected(m: Message) {
    if (m.id.startsWith("temp-")) return;
    setSelectedMsgs((prev) => {
      const next = new Set(prev);
      if (next.has(m.id)) next.delete(m.id);
      else next.add(m.id);
      return next;
    });
  }

  /** Hide or unhide the selected messages for the guest. */
  async function hideSelected(hidden: boolean) {
    const ids = [...selectedMsgs];
    if (ids.length === 0) return;
    const res = await fetch("/api/messages/hide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, messageIds: ids, hidden }),
    });
    if (res.ok) {
      const { messages: updated } = (await res.json()) as { messages: Message[] };
      const byId = new Map(updated.map((m) => [m.id, m]));
      setMessages((prev) => prev.map((m) => byId.get(m.id) ?? m));
      setMsgSelectMode(false);
      setSelectedMsgs(new Set());
    }
  }

  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes("application/x-lolyfans-vault")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  }

  function handleDrop(e: React.DragEvent) {
    setDragOver(false);
    const data = e.dataTransfer.getData("application/x-lolyfans-vault");
    if (!data) return;
    e.preventDefault();
    try {
      const { path, type } = JSON.parse(data);
      if (path && (type === "image" || type === "video")) {
        setAttachment({ path, type });
      }
    } catch {
      // Not a vault item, ignore
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
        .uploadToSignedUrl(path, token, file, { cacheControl: "31536000" });
      if (!error) await send(path, kind);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const byId = new Map(messages.map((m) => [m.id, m]));

  return (
    <div
      className="relative flex flex-col h-full max-w-3xl mx-auto w-full"
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {header}

      {dragOver && (
        <div className="absolute inset-2 z-30 rounded-2xl border-2 border-dashed border-accent bg-accent/10 flex items-center justify-center pointer-events-none">
          <p className="bg-accent text-white text-sm font-semibold rounded-xl px-4 py-2">
            Drop to attach
          </p>
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-16 h-16 rounded-2xl ig-gradient glow-accent flex items-center justify-center">
              <IconChat className="w-8 h-8 text-white" />
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
            onMediaClick={setLightbox}
            onToggleLock={toggleLock}
            selectMode={msgSelectMode}
            selected={selectedMsgs.has(m.id)}
            onSelectToggle={toggleMsgSelected}
          />
        ))}
        {peerTyping && (
          <div className="flex items-end gap-2 msg-in">
            <div className="bg-card2 rounded-3xl rounded-bl-lg px-4 py-3.5 flex items-center gap-1">
              <span className="typing-dot w-2 h-2 rounded-full bg-muted" />
              <span className="typing-dot w-2 h-2 rounded-full bg-muted" />
              <span className="typing-dot w-2 h-2 rounded-full bg-muted" />
            </div>
          </div>
        )}
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
              {(replyTo.content && messagePreviewText(replyTo.content)) ||
                (replyTo.media_type === "image" ? "Photo" : "Video")}
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

      {msgSelectMode && (
        <div className="mx-3 mb-1 px-3 py-2 rounded-xl bg-card2 border border-line flex items-center gap-2 fade-up">
          <p className="flex-1 text-xs font-semibold text-accent">
            {selectedMsgs.size} message{selectedMsgs.size === 1 ? "" : "s"} selected
          </p>
          <button
            onClick={() => hideSelected(true)}
            disabled={selectedMsgs.size === 0}
            className="flex items-center gap-1.5 bg-accent text-white rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          >
            <IconEyeOff className="w-3.5 h-3.5" /> Hide
          </button>
          <button
            onClick={() => hideSelected(false)}
            disabled={selectedMsgs.size === 0}
            className="flex items-center gap-1.5 bg-card border border-line rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          >
            <IconEye className="w-3.5 h-3.5" /> Unhide
          </button>
          <button
            onClick={() => {
              setMsgSelectMode(false);
              setSelectedMsgs(new Set());
            }}
            className="text-muted text-sm px-1"
            aria-label="Cancel selection"
          >
            ✕
          </button>
        </div>
      )}

      {linkAttachment && (
        <div className="mx-3 mb-1 px-3 py-2 rounded-xl bg-card2 border border-line flex items-center gap-3 fade-up">
          <span className="w-8 h-8 rounded-lg bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <IconLink className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-accent truncate">
              {linkAttachment.label || "Hidden link (media opens it)"}
              {linkAttachment.price && ` · $${linkAttachment.price}`}
            </p>
            <p className="text-xs text-muted truncate">{linkAttachment.url}</p>
          </div>
          <button
            onClick={() => setLabelDialog({ ...linkAttachment })}
            className="text-xs font-semibold text-accent px-1"
          >
            Edit
          </button>
          <button
            onClick={() => setLinkAttachment(null)}
            className="text-muted text-sm px-1"
            aria-label="Remove link"
          >
            ✕
          </button>
        </div>
      )}

      {attachment && (
        <div className="mx-3 mb-1 px-3 py-2 rounded-xl bg-card2 border border-line flex items-center gap-3 fade-up">
          {attachment.type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl(attachment.path)}
              alt=""
              className="w-12 h-12 rounded-lg object-cover shrink-0"
            />
          ) : (
            <video
              src={`${mediaUrl(attachment.path)}#t=0.001`}
              muted
              playsInline
              preload="metadata"
              className="w-12 h-12 rounded-lg object-cover shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-accent">
              {attachment.type === "image" ? "Photo" : "Video"} from vault
              {sendLocked && " · will send locked"}
            </p>
            <p className="text-xs text-muted">Add a message below, then send</p>
          </div>
          <button
            onClick={() => setAttachment(null)}
            className="text-muted text-sm px-1"
            aria-label="Remove attachment"
          >
            ✕
          </button>
        </div>
      )}

      <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2 bg-card2/80 border border-line2 rounded-2xl px-2 py-1.5 backdrop-blur">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-9 h-9 rounded-xl bg-accent text-white shrink-0 disabled:opacity-50 flex items-center justify-center active:opacity-80 transition-opacity"
            aria-label="Attach media"
          >
            {uploading ? (
              <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            ) : (
              <IconPlus className="w-5 h-5" />
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          {role === "owner" && (
            <button
              onClick={() => {
                setMsgSelectMode((v) => !v);
                setSelectedMsgs(new Set());
              }}
              className={`w-9 h-9 rounded-xl shrink-0 hidden lg:flex items-center justify-center transition-colors ${
                msgSelectMode
                  ? "bg-accent text-white glow-accent"
                  : "bg-transparent border border-line text-muted hover:text-fg"
              }`}
              aria-label={msgSelectMode ? "Exit message selection" : "Select messages"}
              title={msgSelectMode ? "Exit message selection" : "Select messages to hide"}
            >
              <IconCheck className="w-4.5 h-4.5" />
            </button>
          )}
          {role === "owner" && (
            <button
              onClick={() =>
                setLabelDialog(
                  linkAttachment
                    ? { ...linkAttachment }
                    : { url: "", label: "", price: "" }
                )
              }
              className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center transition-colors ${
                linkAttachment
                  ? "bg-accent text-white glow-accent"
                  : "bg-transparent border border-line text-muted hover:text-fg"
              }`}
              aria-label="Attach a labeled link"
              title="Attach a link with a custom label"
            >
              <IconLink className="w-4.5 h-4.5" />
            </button>
          )}
          {role === "owner" && (
            <button
              onClick={() => setSendLocked((v) => !v)}
              className={`w-9 h-9 rounded-xl shrink-0 hidden lg:flex items-center justify-center transition-colors ${
                sendLocked
                  ? "bg-accent text-white glow-accent"
                  : "bg-transparent border border-line text-muted hover:text-fg"
              }`}
              aria-label={sendLocked ? "Media will send locked" : "Send media locked"}
              title={
                sendLocked
                  ? "Next media sends locked (blurred for them)"
                  : "Send media locked (blurred for them)"
              }
            >
              {sendLocked ? <IconLock className="w-4.5 h-4.5" /> : <IconUnlock className="w-4.5 h-4.5" />}
            </button>
          )}
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value) notifyTyping();
            }}
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
            disabled={!text.trim() && !attachment && !linkAttachment}
            className="w-9 h-9 rounded-xl bg-accent text-white shrink-0 disabled:opacity-40 flex items-center justify-center active:opacity-80 transition-opacity"
            aria-label="Send"
          >
            <IconSend className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>

      {labelDialog && (
        <Portal>
          <div
            className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
            onClick={() => setLabelDialog(null)}
          >
            <div
              className="bg-card border border-line rounded-2xl p-5 w-full max-w-sm space-y-3 fade-up"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-bold">Add a link</p>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted">Link</label>
                <input
                  autoFocus
                  value={labelDialog.url}
                  onChange={(e) =>
                    setLabelDialog({ ...labelDialog, url: e.target.value })
                  }
                  placeholder="https://…"
                  className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted">
                  Link label <span className="font-normal">(optional)</span>
                </label>
                <input
                  value={labelDialog.label}
                  onChange={(e) =>
                    setLabelDialog({ ...labelDialog, label: e.target.value })
                  }
                  onKeyDown={(e) => e.key === "Enter" && applyLinkLabel()}
                  maxLength={80}
                  placeholder="e.g. Payment Link"
                  className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted">
                  Price <span className="font-normal">(optional)</span>
                </label>
                <input
                  value={labelDialog.price}
                  onChange={(e) =>
                    setLabelDialog({ ...labelDialog, price: e.target.value })
                  }
                  onKeyDown={(e) => e.key === "Enter" && applyLinkLabel()}
                  inputMode="decimal"
                  maxLength={12}
                  placeholder="e.g. 25"
                  className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent"
                />
              </div>
              <p className="text-xs text-muted">
                With a label the bubble shows it as a clickable link. Leave the
                label empty on a locked photo/video and the blurred media itself
                opens the link — nothing shows in the message. The price appears
                under the “Locked” badge, or next to the label when there’s no
                media. You can still type a caption in the message box.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setLabelDialog(null)}
                  className="flex-1 py-2.5 rounded-xl bg-card2 border border-line text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={applyLinkLabel}
                  disabled={!labelDialog.url.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-40"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

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
