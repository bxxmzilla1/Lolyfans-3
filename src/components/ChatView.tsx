"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  fileKind,
  mediaUrl,
  MediaKind,
  mediaItemsFromMessage,
  messagePreviewText,
} from "@/lib/utils";
import MessageBubble, { Message } from "./MessageBubble";
import Portal from "./Portal";
import {
  CENTS_PER_TOKEN,
  TIP_TOKEN_PRESETS,
  MIN_TIP_TOKENS,
  TOKEN_PACKS,
  formatTokens,
  packPriceLabel,
  packTotalTokens,
} from "@/lib/tokens";
import {
  IconBack,
  IconChat,
  IconCheck,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconLink,
  IconLock,
  IconPlus,
  IconSend,
  IconTip,
  IconUnlock,
} from "./Icons";

const MAX_ATTACHMENTS = 12;

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
  const [lightbox, setLightbox] = useState<{ message: Message; index: number } | null>(null);
  const [labelDialog, setLabelDialog] = useState<{ url: string; label: string; price: string } | null>(null);
  const [linkAttachment, setLinkAttachment] = useState<{ url: string; label: string; price: string } | null>(null);
  const [labelPresets, setLabelPresets] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<{ path: string; type: MediaKind }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [sendLocked, setSendLocked] = useState(false);
  const [lockPrice, setLockPrice] = useState("");
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [tipTokens, setTipTokens] = useState<number | null>(null);
  const [tipPickerOpen, setTipPickerOpen] = useState(false);
  const [tipCustom, setTipCustom] = useState("");
  const [tipping, setTipping] = useState(false);
  // Token wallet (guest side): balance, the top-up sheet, and why it opened.
  const [balance, setBalance] = useState<number | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletNote, setWalletNote] = useState<string | null>(null);
  const [toppingUp, setToppingUp] = useState<string | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [msgSelectMode, setMsgSelectMode] = useState(false);
  const [selectedMsgs, setSelectedMsgs] = useState<Set<string>>(new Set());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSentAtRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Saved link-label presets live in the creator's profile metadata so they
  // follow them across devices.
  useEffect(() => {
    if (role !== "owner") return;
    supabaseBrowser()
      .auth.getUser()
      .then(({ data }) => {
        const presets = data.user?.user_metadata?.link_label_presets;
        if (Array.isArray(presets)) {
          setLabelPresets(presets.filter((p): p is string => typeof p === "string"));
        }
      });
  }, [role]);

  function persistLabelPresets(next: string[]) {
    setLabelPresets(next);
    supabaseBrowser()
      .auth.updateUser({ data: { link_label_presets: next } })
      .then(() => {});
  }

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
    setAttachments([]);
    setLinkAttachment(null);
    setLockPrice("");
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
                m.media_path === msg.media_path &&
                (m.media_items?.length ?? 0) === (msg.media_items?.length ?? 0)
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
      .on("broadcast", { event: "message-unlocked" }, ({ payload }) => {
        const messageId = (payload as { messageId?: string } | null)?.messageId;
        if (!messageId) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, unlocked: true } : m))
        );
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

  const refreshWallet = useCallback(async () => {
    if (role !== "guest") return;
    try {
      const res = await fetch(`/api/payments/wallet?chatId=${chatId}`);
      if (res.ok) {
        const data = await res.json();
        if (typeof data.balance === "number") setBalance(data.balance);
      }
    } catch {
      // Balance pill just stays hidden until the next refresh.
    }
  }, [role, chatId]);

  useEffect(() => {
    refreshWallet();
  }, [refreshWallet]);

  // After Stripe Checkout (token top-up): confirm the session (covers webhook
  // 308 failures), then refresh the wallet and the thread.
  useEffect(() => {
    if (role !== "guest") return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const paid = params.get("paid") || params.get("tipped") || params.get("topup");
    if (!sessionId && !paid) return;
    window.history.replaceState({}, "", "/chat");
    (async () => {
      if (sessionId) {
        await fetch("/api/payments/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        }).catch(() => {});
      }
      await Promise.all([load(), refreshWallet()]);
    })();
  }, [role, load, refreshWallet]);

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

  function pickTipAmount(tokens: number) {
    setTipTokens(tokens);
    setTipPickerOpen(false);
    setTipCustom("");
    setAttachments([]);
    setLinkAttachment(null);
    setReplyTo(null);
  }

  /** Open the top-up sheet, optionally explaining why (e.g. short on tokens). */
  function openWallet(note?: string) {
    setWalletNote(note ?? null);
    setWalletOpen(true);
  }

  /** Buy a token pack: one tap with a saved card, Stripe Checkout otherwise. */
  async function topUp(packId: string) {
    if (toppingUp) return;
    setToppingUp(packId);
    try {
      const res = await fetch("/api/payments/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, packId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.topped) {
        if (typeof data.balance === "number") setBalance(data.balance);
        setWalletNote(`+${formatTokens(data.tokens ?? 0)} added to your wallet 🎉`);
        setToppingUp(null);
        return;
      }
      if (res.ok && data.checkoutUrl) {
        // First purchase: Stripe saves the card so next top-ups are one tap.
        window.location.href = data.checkoutUrl;
        return;
      }
      alert(data.error || "Could not top up");
    } catch {
      alert("Could not top up");
    }
    setToppingUp(null);
  }

  async function sendTip() {
    if (role !== "guest" || !tipTokens || tipping) return;
    const caption = text.trim();
    setTipping(true);
    try {
      const res = await fetch("/api/payments/tip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, tokens: tipTokens, caption }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.tipped && data.message) {
        setMessages((prev) =>
          prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]
        );
        if (typeof data.balance === "number") setBalance(data.balance);
        setText("");
        setTipTokens(null);
        setTipping(false);
        return;
      }
      if (res.status === 402) {
        if (typeof data.balance === "number") setBalance(data.balance);
        openWallet(
          `You need ${formatTokens(data.needTokens ?? tipTokens)} for this tip — top up to send it.`
        );
        setTipping(false);
        return;
      }
      alert(data.error || "Could not send tip");
    } catch {
      alert("Could not send tip");
    }
    setTipping(false);
  }

  async function send() {
    if (tipTokens) {
      await sendTip();
      return;
    }
    const mediaItems = attachments.map((a) => ({ path: a.path, type: a.type }));
    const usedAttachments = attachments;
    const usedLink = linkAttachment;
    const caption = text.trim();
    // The attached link travels inside the message text as [Label]{price}(url)
    // — empty label = hidden link (media becomes the tap target); the caption
    // from the input goes above it.
    const linkPart = usedLink
      ? `[${usedLink.label}]${usedLink.price ? `{${usedLink.price}}` : ""}(${usedLink.url})`
      : "";
    const content = [caption, linkPart].filter(Boolean).join("\n");
    if (!content && mediaItems.length === 0) return;
    // Owner-set unlock price in Tokens (only on media). A price implies the
    // media is locked so the fan pays to reveal it. Stored as cents (1 Token
    // = 10¢) so revenue records stay in real money.
    const lockTokens =
      role === "owner" && mediaItems.length > 0
        ? Math.round(parseFloat(lockPrice.replace(/[^\d]/g, ""))) || 0
        : 0;
    const priceCents = lockTokens * CENTS_PER_TOKEN;
    const locked = (sendLocked || priceCents > 0) && mediaItems.length > 0;

    // Optimistic: show the message immediately, reconcile with the server response.
    const tempId = `temp-${Date.now()}`;
    const replyToId = replyTo?.id ?? null;
    const temp: Message = {
      id: tempId,
      chat_id: chatId,
      sender: role,
      content: content || null,
      media_path: mediaItems[0]?.path || null,
      media_type: mediaItems[0]?.type || null,
      media_items: mediaItems,
      reply_to_id: replyToId,
      locked,
      price_cents: priceCents,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, temp]);
    setText("");
    setReplyTo(null);
    setAttachments([]);
    if (usedLink) setLinkAttachment(null);
    if (locked) setSendLocked(false);
    if (priceCents > 0) setLockPrice("");

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          content,
          mediaItems,
          mediaPath: mediaItems[0]?.path,
          mediaType: mediaItems[0]?.type,
          replyToId,
          locked,
          priceCents,
        }),
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
        setAttachments(usedAttachments);
        if (usedLink) setLinkAttachment(usedLink);
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(caption);
      setAttachments(usedAttachments);
      if (usedLink) setLinkAttachment(usedLink);
    }
  }

  // Instant token unlock: spends from the wallet; when the balance is short
  // the top-up sheet opens instead (one-tap purchase with a saved card).
  async function unlockMessage(message: Message) {
    if (unlockingId) return;
    setUnlockingId(message.id);
    try {
      const res = await fetch("/api/payments/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.unlocked) {
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, unlocked: true } : m))
        );
        if (typeof data.balance === "number") setBalance(data.balance);
      } else if (res.status === 402) {
        if (typeof data.balance === "number") setBalance(data.balance);
        openWallet(
          data.needTokens
            ? `This unlock costs ${formatTokens(data.needTokens)} — top up to see it.`
            : "Top up your wallet to unlock this."
        );
      } else if (!res.ok) {
        alert(data.error || "Could not unlock");
      }
    } catch {
      alert("Could not unlock");
    }
    setUnlockingId(null);
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

  /** Scroll to the original message and flash-highlight it. */
  function jumpToReply(messageId: string) {
    const el = listRef.current?.querySelector(
      `[data-message-id="${CSS.escape(messageId)}"]`
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    // Retrigger the CSS animation even if tapping the same reply twice.
    setHighlightId(null);
    requestAnimationFrame(() => {
      setHighlightId(messageId);
      highlightTimerRef.current = setTimeout(() => setHighlightId(null), 1500);
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
        setTipTokens(null);
        setAttachments((prev) => {
          if (prev.some((a) => a.path === path)) return prev;
          if (prev.length >= MAX_ATTACHMENTS) return prev;
          return [...prev, { path, type }];
        });
      }
    } catch {
      // Not a vault item, ignore
    }
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files)
      .filter((f) => !!fileKind(f))
      .slice(0, MAX_ATTACHMENTS);
    if (list.length === 0) return;
    setTipTokens(null);
    setUploading(true);
    const uploaded: { path: string; type: MediaKind }[] = [];
    try {
      for (const file of list) {
        const kind = fileKind(file)!;
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, scope: "chat" }),
        });
        if (!res.ok) continue;
        const { path, token } = await res.json();
        const { error } = await supabaseBrowser()
          .storage.from("media")
          .uploadToSignedUrl(path, token, file, { cacheControl: "31536000" });
        if (error) continue;
        uploaded.push({ path, type: kind });
      }
      if (uploaded.length) {
        setAttachments((prev) => {
          const next = [...prev];
          for (const item of uploaded) {
            if (next.length >= MAX_ATTACHMENTS) break;
            if (!next.some((a) => a.path === item.path)) next.push(item);
          }
          return next;
        });
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function openLightbox(message: Message, index = 0) {
    const items = mediaItemsFromMessage(message);
    if (!items.length) return;
    // Locked + unpaid for the fan: media stays unclickable.
    if (
      role === "guest" &&
      message.locked &&
      (message.price_cents ?? 0) > 0 &&
      !message.unlocked
    ) {
      return;
    }
    setLightbox({ message, index: Math.min(Math.max(index, 0), items.length - 1) });
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
            onJumpToReply={jumpToReply}
            onMediaClick={openLightbox}
            onToggleLock={toggleLock}
            onUnlock={unlockMessage}
            unlocking={unlockingId === m.id}
            highlighted={highlightId === m.id}
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
                (() => {
                  const n = mediaItemsFromMessage(replyTo).length;
                  if (n > 1) return `${n} files`;
                  return replyTo.media_type === "image" ? "Photo" : "Video";
                })()}
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

      {tipTokens != null && (
        <div className="mx-3 mb-1 px-3 py-2 rounded-xl bg-card2 border border-line flex items-center gap-3 fade-up">
          <span className="w-8 h-8 rounded-lg bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <IconTip className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-accent">
              Tip {formatTokens(tipTokens)}
            </p>
            <p className="text-xs text-muted">
              Add an optional note below, then send
            </p>
          </div>
          <button
            onClick={() => setTipPickerOpen(true)}
            className="text-xs font-semibold text-accent px-1"
          >
            Edit
          </button>
          <button
            onClick={() => setTipTokens(null)}
            className="text-muted text-sm px-1"
            aria-label="Cancel tip"
          >
            ✕
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mx-3 mb-1 px-3 py-2 rounded-xl bg-card2 border border-line space-y-2 fade-up">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-xs font-semibold text-accent">
              {attachments.length} file{attachments.length === 1 ? "" : "s"} attached
              {(sendLocked || parseFloat(lockPrice) > 0) && " · will send locked"}
            </p>
            <button
              onClick={() => setAttachments([])}
              className="text-muted text-xs font-semibold px-1"
            >
              Clear
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {attachments.map((item, i) => (
              <div key={`${item.path}-${i}`} className="relative shrink-0">
                {item.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(item.path)}
                    alt=""
                    className="w-14 h-14 rounded-lg object-cover"
                  />
                ) : (
                  <video
                    src={`${mediaUrl(item.path)}#t=0.001`}
                    muted
                    playsInline
                    preload="metadata"
                    className="w-14 h-14 rounded-lg object-cover"
                  />
                )}
                <button
                  onClick={() =>
                    setAttachments((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-bold"
                  aria-label="Remove attachment"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {role === "owner" ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted">Unlock price</span>
              <IconTip className="w-3.5 h-3.5 text-accent" />
              <input
                value={lockPrice}
                onChange={(e) => setLockPrice(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="0"
                className="w-16 bg-bg border border-line rounded-lg px-2 py-1 text-xs focus:border-accent"
              />
              <span className="text-xs text-muted">Tokens</span>
              <span className="text-[11px] text-muted">
                {parseInt(lockPrice, 10) > 0
                  ? "fan pays once to unlock all"
                  : "free / manual lock"}
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted">Add a message below, then send</p>
          )}
        </div>
      )}

      <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* Token balance sits above the input so the composer keeps its space */}
        {role === "guest" && balance !== null && (
          <button
            onClick={() => openWallet()}
            className="w-full mb-2 flex items-center gap-2.5 rounded-2xl bg-card2/90 border border-accent/30 px-3.5 py-2 backdrop-blur hover:border-accent transition-colors"
            aria-label="Your token wallet"
            title="Your token wallet"
          >
            <span className="w-7 h-7 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
              <IconTip className="w-4 h-4" />
            </span>
            <span className="flex-1 min-w-0 text-left">
              <span className="block text-[11px] font-semibold text-muted leading-tight">
                Token balance
              </span>
              <span className="block text-sm font-extrabold tabular-nums text-fg leading-tight">
                {balance.toLocaleString("en-US")}
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-accent text-white text-xs font-bold px-3 py-1.5">
              Top up
            </span>
          </button>
        )}
        <div className="flex items-end gap-2 bg-card2/80 border border-line2 rounded-2xl px-2 py-1.5 backdrop-blur">
          <button
            onClick={() => {
              setTipTokens(null);
              fileRef.current?.click();
            }}
            disabled={uploading || tipping}
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
            multiple
            hidden
            onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
          />
          {role === "guest" && (
            <button
              onClick={() => setTipPickerOpen(true)}
              disabled={tipping}
              className={`h-9 px-3 rounded-xl shrink-0 flex items-center justify-center text-sm font-semibold transition-colors disabled:opacity-50 ${
                tipTokens != null
                  ? "bg-accent text-white glow-accent"
                  : "bg-transparent border border-line text-muted hover:text-fg"
              }`}
              aria-label="Send a tip"
              title="Send a tip"
            >
              Tip
            </button>
          )}
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
              if (e.target.value && tipTokens == null) notifyTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (tipTokens != null) sendTip();
                else send();
              }
            }}
            placeholder={tipTokens != null ? "Add a note (optional)…" : "Message…"}
            rows={1}
            disabled={tipping}
            className="flex-1 bg-transparent resize-none max-h-32 py-2 text-[15px] placeholder:text-muted disabled:opacity-60"
          />
          <button
            onClick={() => (tipTokens != null ? sendTip() : send())}
            disabled={
              tipping ||
              uploading ||
              (tipTokens == null &&
                !text.trim() &&
                attachments.length === 0 &&
                !linkAttachment)
            }
            className="w-9 h-9 rounded-xl bg-accent text-white shrink-0 disabled:opacity-40 flex items-center justify-center active:opacity-80 transition-opacity"
            aria-label={tipTokens != null ? "Send tip" : "Send"}
          >
            {tipping ? (
              <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            ) : (
              <IconSend className="w-4.5 h-4.5" />
            )}
          </button>
        </div>
      </div>

      {tipPickerOpen && (
        <Portal>
          <div
            className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center p-4"
            onClick={() => setTipPickerOpen(false)}
          >
            <div
              className="bg-card border border-line rounded-2xl p-5 w-full max-w-sm space-y-4 fade-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold">Send a tip</p>
                <button
                  onClick={() => setTipPickerOpen(false)}
                  className="text-muted text-sm px-1"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm text-muted -mt-2">
                Pick an amount in Tokens. You can add a note in the chat box before sending.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {TIP_TOKEN_PRESETS.map((tokens) => (
                  <button
                    key={tokens}
                    onClick={() => pickTipAmount(tokens)}
                    className={`rounded-xl border px-3 py-3 text-sm font-semibold transition-colors ${
                      tipTokens === tokens
                        ? "bg-accent text-white border-accent"
                        : "bg-card2 border-line hover:border-accent"
                    }`}
                  >
                    {tokens.toLocaleString("en-US")}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted">Custom amount</label>
                <div className="flex items-center gap-2">
                  <IconTip className="w-4 h-4 text-accent shrink-0" />
                  <input
                    value={tipCustom}
                    onChange={(e) => setTipCustom(e.target.value.replace(/[^\d]/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const tokens = Math.round(parseFloat(tipCustom));
                      if (tokens >= MIN_TIP_TOKENS) pickTipAmount(tokens);
                    }}
                    inputMode="numeric"
                    placeholder="250"
                    className="flex-1 bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent"
                  />
                  <button
                    onClick={() => {
                      const tokens = Math.round(parseFloat(tipCustom));
                      if (tokens >= MIN_TIP_TOKENS) pickTipAmount(tokens);
                    }}
                    disabled={!(Math.round(parseFloat(tipCustom)) >= MIN_TIP_TOKENS)}
                    className="rounded-xl bg-accent text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
                  >
                    Use
                  </button>
                </div>
                <p className="text-[11px] text-muted">Minimum {MIN_TIP_TOKENS} Tokens</p>
              </div>
              {balance !== null && (
                <div className="flex items-center justify-between rounded-xl bg-card2 border border-line px-3 py-2.5">
                  <p className="text-xs text-muted">
                    Wallet:{" "}
                    <span className="font-bold text-fg">{formatTokens(balance)}</span>
                  </p>
                  <button
                    onClick={() => {
                      setTipPickerOpen(false);
                      openWallet();
                    }}
                    className="text-xs font-semibold text-accent"
                  >
                    Top up
                  </button>
                </div>
              )}
            </div>
          </div>
        </Portal>
      )}

      {walletOpen && (
        <Portal>
          <div
            className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center p-4"
            onClick={() => setWalletOpen(false)}
          >
            <div
              className="bg-card border border-line rounded-2xl p-5 w-full max-w-sm space-y-4 fade-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold">Your wallet</p>
                <button
                  onClick={() => setWalletOpen(false)}
                  className="text-muted text-sm px-1"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl bg-card2 border border-line px-4 py-3">
                <span className="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
                  <IconTip className="w-5 h-5" />
                </span>
                <div>
                  <p className="text-lg font-extrabold leading-tight tabular-nums">
                    {(balance ?? 0).toLocaleString("en-US")}{" "}
                    <span className="text-sm font-semibold text-muted">Tokens</span>
                  </p>
                  <p className="text-[11px] text-muted">Spend on unlocks & tips</p>
                </div>
              </div>
              {walletNote && (
                <p className="text-sm text-accent font-semibold -mt-1">{walletNote}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {TOKEN_PACKS.map((pack) => {
                  const total = packTotalTokens(pack);
                  const busy = toppingUp === pack.id;
                  return (
                    <button
                      key={pack.id}
                      onClick={() => topUp(pack.id)}
                      disabled={!!toppingUp}
                      className={`relative rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-60 ${
                        pack.tag === "Most popular"
                          ? "border-accent bg-accent/10"
                          : "bg-card2 border-line hover:border-accent"
                      }`}
                    >
                      {pack.tag && (
                        <span className="absolute -top-2 right-2 rounded-full bg-accent text-white text-[10px] font-bold px-2 py-0.5">
                          {pack.tag}
                        </span>
                      )}
                      <p className="text-base font-extrabold tabular-nums">
                        {total.toLocaleString("en-US")}
                        <span className="text-xs font-semibold text-muted"> Tokens</span>
                      </p>
                      {pack.bonusTokens > 0 && (
                        <p className="text-[11px] font-semibold text-emerald-500">
                          incl. +{pack.bonusTokens.toLocaleString("en-US")} free
                        </p>
                      )}
                      <p className="mt-1 text-sm font-bold text-accent">
                        {busy ? "Processing…" : packPriceLabel(pack)}
                      </p>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted text-center">
                One-tap with your saved card · secured by Stripe
              </p>
              <p className="text-[11px] text-muted/80 text-center -mt-2">
                All Token purchases are final and non-refundable.
              </p>
            </div>
          </div>
        </Portal>
      )}

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
                {labelPresets.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {labelPresets.map((preset) => (
                      <span
                        key={preset}
                        className={`inline-flex items-center gap-1 rounded-full border pl-3 pr-1.5 py-1 text-xs font-semibold ${
                          labelDialog.label === preset
                            ? "bg-accent text-white border-accent"
                            : "bg-card2 border-line text-fg"
                        }`}
                      >
                        <button
                          onClick={() =>
                            setLabelDialog({ ...labelDialog, label: preset })
                          }
                        >
                          {preset}
                        </button>
                        <button
                          onClick={() =>
                            persistLabelPresets(labelPresets.filter((p) => p !== preset))
                          }
                          aria-label={`Delete preset ${preset}`}
                          className="opacity-60 hover:opacity-100 px-0.5"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {labelDialog.label.trim() &&
                  !labelPresets.includes(labelDialog.label.trim()) && (
                    <button
                      onClick={() =>
                        persistLabelPresets([...labelPresets, labelDialog.label.trim()])
                      }
                      className="text-xs font-semibold text-accent hover:opacity-80"
                    >
                      + Save “{labelDialog.label.trim()}” as preset
                    </button>
                  )}
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

      {lightbox && (() => {
        const items = mediaItemsFromMessage(lightbox.message);
        const item = items[lightbox.index];
        if (!item) return null;
        return (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setLightbox(null)}
          >
            <div
              className="relative max-w-full max-h-full"
              onClick={(e) => e.stopPropagation()}
            >
              {item.type === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(item.path)}
                  alt="Photo"
                  className="max-w-full max-h-[85vh] rounded-xl object-contain"
                />
              ) : (
                <video
                  src={mediaUrl(item.path)}
                  controls
                  autoPlay
                  playsInline
                  className="max-w-full max-h-[85vh] rounded-xl"
                />
              )}
              {items.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox({
                        message: lightbox.message,
                        index: (lightbox.index - 1 + items.length) % items.length,
                      })
                    }
                    aria-label="Previous media"
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center"
                  >
                    <IconBack className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox({
                        message: lightbox.message,
                        index: (lightbox.index + 1) % items.length,
                      })
                    }
                    aria-label="Next media"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center"
                  >
                    <IconChevronRight className="w-5 h-5" />
                  </button>
                  <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 text-white text-xs font-semibold px-3 py-1 tabular-nums">
                    {lightbox.index + 1}/{items.length}
                  </span>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
