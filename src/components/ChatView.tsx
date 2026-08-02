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
import EmbeddedCardTopup from "./EmbeddedCardTopup";
import IncomingMediaGate from "./IncomingMediaGate";
import BlurDrainerEditor from "./BlurDrainerEditor";
import BlurDrainerPlayer from "./BlurDrainerPlayer";
import { elementsEnabled, getStripe } from "@/lib/stripeClient";
import { parseBlurDrainer, type BlurDrainerConfig } from "@/lib/blurDrainer";
import {
  CENTS_PER_TOKEN,
  TIP_TOKEN_PRESETS,
  MIN_TIP_TOKENS,
  TOKEN_PACKS,
  formatTokens,
  packTotalTokens,
  perTokenLabel,
} from "@/lib/tokens";
import { formatCouponMessage, offerPriceLabel } from "@/lib/coupon";
import {
  IconBack,
  IconChat,
  IconCheck,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconLink,
  IconLock,
  IconMic,
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
  ownerId,
  peerName,
}: {
  chatId: string;
  role: "owner" | "guest";
  header: React.ReactNode;
  initialMessages?: Message[];
  /** Guest side: creator's id, so typing can reach their inbox chat list. */
  ownerId?: string;
  /** Guest side: creator's display name, shown on incoming locked media. */
  peerName?: string;
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
  // Optional decision countdown (seconds) for the incoming-media gate.
  const [decideTimer, setDecideTimer] = useState("");
  // BlurDrainer: config attached to the next video send + editor / player UI.
  const [blurDrainer, setBlurDrainer] = useState<BlurDrainerConfig | null>(null);
  const [blurEditorOpen, setBlurEditorOpen] = useState(false);
  const [drainPlayer, setDrainPlayer] = useState<Message | null>(null);
  // BlurDrainer gate: card SetupIntent required before Accept can proceed.
  const [gateCardSetup, setGateCardSetup] = useState<{
    clientSecret: string;
    country: string | null;
    messageId: string;
  } | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [tipTokens, setTipTokens] = useState<number | null>(null);
  const [tipPickerOpen, setTipPickerOpen] = useState(false);
  const [tipCustom, setTipCustom] = useState("");
  const [tipping, setTipping] = useState(false);
  // Token wallet (guest side): balance, the top-up sheet, and why it opened.
  const [balance, setBalance] = useState<number | null>(null);
  const balanceRef = useRef<number | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletNote, setWalletNote] = useState<string | null>(null);
  const [toppingUp, setToppingUp] = useState<string | null>(null);
  // In-flight guards readable from memoized bubbles' older closures.
  const unlockingRef = useRef(false);
  // First purchase: the composer area swaps for the embedded 3-step card
  // wizard instead of redirecting to Stripe Checkout.
  const [cardTopup, setCardTopup] = useState<{
    clientSecret: string;
    amountCents: number;
    tokens: number;
    country: string | null;
  } | null>(null);
  // The message the fan tried to accept while short on tokens — it unlocks
  // automatically the moment their top-up lands.
  const pendingUnlockIdRef = useRef<string | null>(null);
  const [startingVerify, setStartingVerify] = useState(false);
  // Owner side: coupon + Stripe payment link composers.
  const [offerDialog, setOfferDialog] = useState<{
    tokens: string;
    price: string;
    original: string;
  } | null>(null);
  const [sendingOffer, setSendingOffer] = useState(false);
  const [claimingCouponId, setClaimingCouponId] = useState<string | null>(null);
  const [redeemedCoupons, setRedeemedCoupons] = useState<Set<string>>(
    () => new Set()
  );
  const [payLinkDialog, setPayLinkDialog] = useState<{
    tokens: string;
    price: string;
    url: string | null;
  } | null>(null);
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // Incoming-media gate (guest side): accept/reject in flight + the
  // countdown remaining for the media currently on screen.
  const [deciding, setDeciding] = useState(false);
  const [gateLeft, setGateLeft] = useState<number | null>(null);
  const gateIdRef = useRef<string | null>(null);
  // Voice notes: recording state + the moment between stop and message sent.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [sendingVoice, setSendingVoice] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordCancelRef = useRef(false);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [msgSelectMode, setMsgSelectMode] = useState(false);
  const [selectedMsgs, setSelectedMsgs] = useState<Set<string>>(new Set());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** Focus the composer so the next keystroke / Enter goes straight in. */
  function focusComposer() {
    // Wait a frame so reply/attachment UI has mounted above the input.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }
  const channelRef = useRef<RealtimeChannel | null>(null);
  const inboxTypingRef = useRef<RealtimeChannel | null>(null);
  const typingHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSentAtRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Blocks double Enter / double-tap from posting the same message twice.
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);

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
      return;
    }
    // The creator deleted this chat while the fan had it open — the session is
    // dead, so hand them over to the public home page.
    if (role === "guest" && res.status === 401) {
      window.location.href = "/api/guest/gone";
    }
  }, [chatId, role]);

  // Jump straight to the latest message when opening a chat (no smooth scroll delay)
  useEffect(() => {
    setMessages(initialMessages ?? []);
    setPeerTyping(false);
    setReplyTo(null);
    setAttachments([]);
    setLinkAttachment(null);
    setLockPrice("");
    setDecideTimer("");
    setBlurDrainer(null);
    setBlurEditorOpen(false);
    setDrainPlayer(null);
    setGateCardSetup(null);
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
            const tempIdx = prev.findIndex((m) => {
              if (!m.id.startsWith("temp-")) return false;
              // Same media path is enough (BlurDrainer / lock fields can differ
              // slightly between optimistic and server payloads).
              if (msg.media_path && m.media_path === msg.media_path) return true;
              const sameContent =
                (m.content ?? null) === (msg.content ?? null);
              const sameMedia =
                (m.media_path ?? null) === (msg.media_path ?? null);
              return sameContent && sameMedia;
            });
            if (tempIdx !== -1) {
              const copy = [...prev];
              copy[tempIdx] = msg;
              return copy;
            }
            // No temp left (POST already reconciled) — id check above prevents
            // a true duplicate. Still append so external/API sends show live.
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
        // Unlocked implies accepted (paying IS the fan's Accept).
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, unlocked: true, fan_decision: m.fan_decision ?? "accepted" }
              : m
          )
        );
      })
      .on("broadcast", { event: "blur-drain-progress" }, ({ payload }) => {
        const p = payload as { messageId?: string; layersCleared?: number } | null;
        if (!p?.messageId || typeof p.layersCleared !== "number") return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === p.messageId
              ? {
                  ...m,
                  blur_layers_cleared: Math.max(
                    m.blur_layers_cleared ?? 0,
                    p.layersCleared!
                  ),
                }
              : m
          )
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

  // Creator: poll accept/decline/unlock (+ card status for the header).
  // Kept gentle (5s) so we don't 503 the deployment; realtime still covers
  // the instant path. Also feeds FanWalletStatus via a window event.
  useEffect(() => {
    if (role !== "owner") return;
    let stopped = false;
    let inflight = false;
    async function tick() {
      if (stopped || inflight || document.visibilityState !== "visible") return;
      inflight = true;
      try {
        const res = await fetch(`/api/chats/fanstate?chatId=${chatId}`);
        if (!res.ok || stopped) return;
        const data = (await res.json()) as {
          balance?: number;
          hasCard?: boolean;
          media?: {
            id: string;
            fan_decision: "accepted" | "rejected" | null;
            unlocked: boolean;
            blur_layers_cleared?: number;
          }[];
        };
        window.dispatchEvent(
          new CustomEvent("loly-fanstate", {
            detail: {
              chatId,
              balance: data.balance,
              hasCard: data.hasCard,
            },
          })
        );
        const media = data.media ?? [];
        if (!media.length) return;
        const byId = new Map(media.map((m) => [m.id, m]));
        setMessages((prev) => {
          let changed = false;
          const next = prev.map((m) => {
            const d = byId.get(m.id);
            if (!d) return m;
            const drained = d.blur_layers_cleared ?? 0;
            if (
              m.fan_decision === d.fan_decision &&
              !!m.unlocked === d.unlocked &&
              (m.blur_layers_cleared ?? 0) === drained
            ) {
              return m;
            }
            changed = true;
            return {
              ...m,
              fan_decision: d.fan_decision,
              unlocked: d.unlocked,
              blur_layers_cleared: drained,
            };
          });
          return changed ? next : prev;
        });
      } catch {
        // offline blip — next tick retries
      } finally {
        inflight = false;
      }
    }
    const timer = setInterval(tick, 5000);
    tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [role, chatId]);

  // Token wallet for this chat.
  const refreshWallet = useCallback(async () => {
    if (role !== "guest") return;
    try {
      const res = await fetch(`/api/payments/wallet?chatId=${chatId}`);
      if (res.ok) {
        const data = await res.json();
        if (typeof data.balance === "number") {
          const nextBal = data.balance as number;
          const changed = balanceRef.current !== nextBal;
          balanceRef.current = nextBal;
          setBalance(nextBal);
          // Only notify the header when the number actually changes — never
          // on the quiet 5s poll, so the bubble doesn't keep reappearing.
          if (changed) {
            queueMicrotask(() =>
              window.dispatchEvent(
                new CustomEvent("loly-wallet", {
                  detail: { chatId, balance: nextBal },
                })
              )
            );
          }
        }
      }
    } catch {
      // The server-rendered values stay until the next refresh.
    }
  }, [role, chatId]);

  useEffect(() => {
    refreshWallet();
  }, [refreshWallet]);

  // Preload Stripe.js while the fan still has credit: parsing the script and
  // mounting its iframes at the exact moment the card wizard swaps in is what
  // used to freeze phones. Idle-time load keeps the swap instant.
  useEffect(() => {
    if (role !== "guest" || !elementsEnabled()) return;
    const idle = window.setTimeout(() => void getStripe(), 1500);
    return () => window.clearTimeout(idle);
  }, [role]);

  // Keep the wallet balance fresh.
  useEffect(() => {
    if (role !== "guest") return;
    const timer = setInterval(() => {
      if (!document.hidden) refreshWallet();
    }, 5000);
    return () => clearInterval(timer);
  }, [role, refreshWallet]);

  // Incoming-media gate: creator photos/videos the fan hasn't decided on yet
  // show full screen (blurred) with Accept / Reject instead of in the chat.
  // fan_decision === null strictly — absent means the column isn't migrated
  // yet, so the gate stays dormant rather than trapping every old message.
  const needsDecision = useCallback(
    (m: Message) =>
      role === "guest" &&
      m.sender === "owner" &&
      !m.id.startsWith("temp-") &&
      m.fan_decision === null &&
      !m.unlocked &&
      mediaItemsFromMessage(m).some((i) => i.type === "image" || i.type === "video"),
    [role]
  );
  // Oldest undecided first; the next one takes over after each decision.
  const pendingGate = messages.find(needsDecision) ?? null;
  const visibleMessages =
    role === "guest"
      ? messages.filter((m) => m.fan_decision !== "rejected" && !needsDecision(m))
      : messages;
  // The countdown pauses while a decision/payment is in flight or the card
  // wizard is open — closing the wizard without finishing resumes it.
  const gatePaused =
    deciding ||
    unlockingId === pendingGate?.id ||
    (!!gateCardSetup && gateCardSetup.messageId === pendingGate?.id) ||
    !!cardTopup;

  /** Accept or reject the media currently on the gate (free/manual-lock). */
  const decideGate = useCallback(
    async (message: Message, decision: "accept" | "reject") => {
      if (deciding) return false;
      setDeciding(true);
      try {
        const res = await fetch("/api/messages/decide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: message.id, decision }),
        });
        if (res.ok) {
          const fan = decision === "accept" ? "accepted" : "rejected";
          setMessages((prev) =>
            prev.map((m) => (m.id === message.id ? { ...m, fan_decision: fan } : m))
          );
          try {
            localStorage.removeItem(`lf-decide-left:${message.id}`);
          } catch {}
          if (decision === "reject") setGateCardSetup(null);
          setDeciding(false);
          return true;
        }
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Something went wrong — try again");
      } catch {
        alert("Something went wrong — try again");
      }
      setDeciding(false);
      return false;
    },
    [deciding]
  );

  /** BlurDrainer Accept without a card: SetupIntent wizard (no charge). */
  async function startGateCardSetup(messageId: string) {
    if (startingVerify || gateCardSetup) return;
    setStartingVerify(true);
    try {
      const res = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.clientSecret) {
        setGateCardSetup({
          clientSecret: data.clientSecret,
          country: data.country ?? null,
          messageId,
        });
      } else {
        alert(data.error || "Could not start card setup");
      }
    } catch {
      alert("Could not start card setup");
    }
    setStartingVerify(false);
  }

  async function completeGateCardSetup(setupIntentId: string) {
    try {
      await fetch("/api/payments/verify/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, setupIntentId }),
      });
    } catch {
      // Card is already on Stripe; refresh catches up.
    }
    const messageId = gateCardSetup?.messageId;
    setGateCardSetup(null);
    const msg = messages.find((m) => m.id === messageId) ?? pendingGate;
    if (msg && parseBlurDrainer(msg.blur_drainer)) {
      const ok = await decideGate(msg, "accept");
      if (ok) setDrainPlayer(msg);
    }
  }

  /** Accept: BlurDrainer opens even without a card — card is collected on
   *  the first tap inside the player. Priced media pays; free accepts. */
  async function acceptGate(message: Message) {
    if (parseBlurDrainer(message.blur_drainer)) {
      const ok = await decideGate(message, "accept");
      if (ok) setDrainPlayer(message);
      return;
    }
    if ((message.price_cents ?? 0) > 0 && message.locked && !message.unlocked) {
      unlockById(message.id);
    } else {
      decideGate(message, "accept");
    }
  }

  // Start (or restore) the countdown when a new gate message appears. The
  // remaining time persists in localStorage so a refresh doesn't reset it.
  useEffect(() => {
    const id = pendingGate?.id ?? null;
    if (gateIdRef.current === id) return;
    gateIdRef.current = id;
    if (!pendingGate || !(pendingGate.decide_seconds && pendingGate.decide_seconds > 0)) {
      setGateLeft(null);
      return;
    }
    let left = pendingGate.decide_seconds;
    try {
      const saved = parseInt(
        localStorage.getItem(`lf-decide-left:${pendingGate.id}`) ?? "",
        10
      );
      if (Number.isFinite(saved) && saved >= 0 && saved < left) left = saved;
    } catch {}
    setGateLeft(left);
  }, [pendingGate]);

  // Tick once a second (unless paused); hitting zero auto-rejects.
  useEffect(() => {
    if (gateLeft === null || !pendingGate || gatePaused) return;
    if (gateLeft <= 0) {
      decideGate(pendingGate, "reject");
      return;
    }
    const t = setTimeout(() => {
      setGateLeft((s) => {
        const next = s === null ? null : Math.max(0, s - 1);
        if (next !== null) {
          try {
            localStorage.setItem(`lf-decide-left:${pendingGate.id}`, String(next));
          } catch {}
        }
        return next;
      });
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateLeft, gatePaused, pendingGate?.id]);

  // Home-gate shortfall: open the wallet with the note, keep pending unlock.
  useEffect(() => {
    if (role !== "guest") return;
    let note: string | null = null;
    let pendingId: string | null = null;
    try {
      note = sessionStorage.getItem("lf-open-wallet-note");
      pendingId = sessionStorage.getItem("lf-pending-unlock");
      if (note) sessionStorage.removeItem("lf-open-wallet-note");
    } catch {}
    if (pendingId) pendingUnlockIdRef.current = pendingId;
    if (note) openWallet(note);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // After Stripe Checkout (token top-up): confirm the session, refresh, then
  // finish a pending accept if the fan was short on tokens.
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
      let pendingId: string | null = null;
      try {
        pendingId = sessionStorage.getItem("lf-pending-unlock");
        sessionStorage.removeItem("lf-pending-unlock");
      } catch {}
      if (pendingId) unlockById(pendingId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, load, refreshWallet]);

  useEffect(() => {
    scrollToBottom(true);
  }, [messages.length, peerTyping, scrollToBottom]);

  // Guest side: a second channel to the creator's inbox topic, so their chat
  // list can show the typing animation without joining every chat channel.
  useEffect(() => {
    if (role !== "guest" || !ownerId) return;
    const supabase = supabaseBrowser();
    const channel = supabase.channel(`inbox:${ownerId}`);
    channel.subscribe();
    inboxTypingRef.current = channel;
    return () => {
      inboxTypingRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [role, ownerId]);

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
    inboxTypingRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { chatId, sender: role },
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

  const openWalletGuardRef = useRef(0);
  /** Open the top-up sheet, optionally explaining why (e.g. short on tokens). */
  function openWallet(note?: string) {
    const now = Date.now();
    // Collapse rapid double-opens (header tap + shortfall, or mobile double-fire).
    if (walletOpen && now - openWalletGuardRef.current < 800) {
      if (note) setWalletNote(note);
      return;
    }
    openWalletGuardRef.current = now;
    setWalletNote(note ?? null);
    setWalletOpen(true);
  }

  /** Dismissing the sheet without paying forgets the pending auto-accept. */
  function closeWallet() {
    setWalletOpen(false);
    pendingUnlockIdRef.current = null;
  }

  /** Buy a token pack: one tap with a saved card; first purchase opens the
   *  in-chat card wizard (or Stripe Checkout as fallback). */
  async function topUp(packId: string) {
    if (toppingUp) return;
    setToppingUp(packId);
    try {
      const res = await fetch("/api/payments/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          packId,
          embedded: elementsEnabled(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.topped) {
        if (typeof data.balance === "number") setBalance(data.balance);
        setToppingUp(null);
        const pendingId = pendingUnlockIdRef.current;
        if (pendingId) {
          pendingUnlockIdRef.current = null;
          setWalletOpen(false);
          unlockById(pendingId);
          return;
        }
        setWalletNote(`+${formatTokens(data.tokens ?? 0)} added to your wallet 🎉`);
        setWalletOpen(true);
        return;
      }
      if (res.ok && data.clientSecret) {
        setWalletOpen(false);
        setCardTopup({
          clientSecret: data.clientSecret,
          amountCents: Number(data.amountCents ?? 0),
          tokens: Number(data.tokens ?? 0),
          country: data.country ?? null,
        });
        setToppingUp(null);
        return;
      }
      if (res.ok && data.checkoutUrl) {
        if (pendingUnlockIdRef.current) {
          try {
            sessionStorage.setItem("lf-pending-unlock", pendingUnlockIdRef.current);
          } catch {}
        }
        window.location.href = data.checkoutUrl;
        return;
      }
      alert(data.error || "Could not top up");
    } catch {
      alert("Could not top up");
    }
    setToppingUp(null);
  }

  async function completeCardTopup(paymentIntentId: string) {
    let data: { balance?: number; tokens?: number } = {};
    try {
      const res = await fetch("/api/payments/topup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, paymentIntentId }),
      });
      if (res.ok) data = await res.json().catch(() => ({}));
    } catch {
      // The webhook still credits the payment; the balance catches up.
    }
    setCardTopup(null);
    if (typeof data.balance === "number") setBalance(data.balance);
    let couponId: string | null = null;
    try {
      couponId = sessionStorage.getItem("lf-pending-coupon");
      sessionStorage.removeItem("lf-pending-coupon");
    } catch {}
    if (couponId) {
      setRedeemedCoupons((prev) => new Set(prev).add(couponId!));
    }
    const pendingId = pendingUnlockIdRef.current;
    if (pendingId) {
      pendingUnlockIdRef.current = null;
      unlockById(pendingId);
      return;
    }
    setWalletNote(`+${formatTokens(data.tokens ?? 0)} added to your wallet 🎉`);
    setWalletOpen(true);
  }

  async function sendCustomOffer() {
    if (!offerDialog || sendingOffer) return;
    const tokens = Math.round(parseFloat(offerDialog.tokens));
    const priceCents = Math.round(parseFloat(offerDialog.price) * 100);
    const originalCents = Math.round(parseFloat(offerDialog.original) * 100);
    if (!(tokens > 0) || !(priceCents > 0) || !(originalCents > 0)) {
      alert("Enter the tokens, price and original price.");
      return;
    }
    if (originalCents < priceCents) {
      alert("Original price should be higher than the discounted price.");
      return;
    }
    setSendingOffer(true);
    try {
      const content = formatCouponMessage({
        id: crypto.randomUUID(),
        tokens,
        priceCents,
        originalCents,
      });
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, content }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.message) {
        setMessages((prev) =>
          prev.some((m) => m.id === data.message.id)
            ? prev
            : [...prev, data.message]
        );
        setOfferDialog(null);
      } else {
        alert(data.error || "Could not send the coupon");
      }
    } catch {
      alert("Could not send the coupon");
    }
    setSendingOffer(false);
  }

  /** Fan claims a coupon bubble — one-time discounted token pack. */
  async function claimCoupon(messageId: string) {
    if (claimingCouponId || role !== "guest") return;
    setClaimingCouponId(messageId);
    try {
      const res = await fetch("/api/payments/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          couponMessageId: messageId,
          embedded: elementsEnabled(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.topped) {
        if (typeof data.balance === "number") setBalance(data.balance);
        setRedeemedCoupons((prev) => new Set(prev).add(messageId));
        setWalletNote(`+${formatTokens(data.tokens ?? 0)} added to your wallet 🎉`);
        setWalletOpen(true);
      } else if (res.ok && data.clientSecret) {
        setCardTopup({
          clientSecret: data.clientSecret,
          amountCents: Number(data.amountCents ?? 0),
          tokens: Number(data.tokens ?? 0),
          country: data.country ?? null,
        });
        // Remember which coupon this card wizard is for so complete can mark it.
        pendingUnlockIdRef.current = null;
        sessionStorage.setItem("lf-pending-coupon", messageId);
      } else if (res.ok && data.checkoutUrl) {
        try {
          sessionStorage.setItem("lf-pending-coupon", messageId);
        } catch {}
        window.location.href = data.checkoutUrl;
        return;
      } else if (res.status === 410) {
        setRedeemedCoupons((prev) => new Set(prev).add(messageId));
        alert(data.error || "This coupon has already been used");
      } else {
        alert(data.error || "Could not claim coupon");
      }
    } catch {
      alert("Could not claim coupon");
    }
    setClaimingCouponId(null);
  }

  async function createPayLink() {
    if (!payLinkDialog || creatingLink) return;
    const tokens = Math.round(parseFloat(payLinkDialog.tokens));
    const priceCents = Math.round(parseFloat(payLinkDialog.price) * 100);
    if (!(tokens > 0) || !(priceCents >= 50)) {
      alert("Enter the tokens and a price of at least $0.50.");
      return;
    }
    setCreatingLink(true);
    try {
      const res = await fetch("/api/chats/paylink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, tokens, priceCents }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        setLinkCopied(false);
        setPayLinkDialog({ ...payLinkDialog, url: data.url });
      } else {
        alert(data.error || "Could not create the link");
      }
    } catch {
      alert("Could not create the link");
    }
    setCreatingLink(false);
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

  useEffect(() => {
    if (role !== "guest") return;
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail as { chatId?: string; note?: string } | null;
      if (d?.chatId && d.chatId !== chatId) return;
      openWallet(d?.note);
    };
    window.addEventListener("loly-open-wallet", onOpen);
    return () => window.removeEventListener("loly-open-wallet", onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, chatId]);

  async function send() {
    if (tipTokens) {
      await sendTip();
      return;
    }
    // Ref guard must run before any await — React state hasn't cleared yet on
    // a double Enter / double-tap, so both calls would otherwise POST.
    if (sendingRef.current || uploading) return;
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
    sendingRef.current = true;
    setSending(true);
    // Owner-set unlock price in Tokens (only on media). Stored as cents
    // (1 Token = 10¢) so revenue records stay in real money.
    const lockTokens =
      role === "owner" && mediaItems.length > 0
        ? Math.round(parseFloat(lockPrice.replace(/[^\d]/g, ""))) || 0
        : 0;
    const priceCents = lockTokens * CENTS_PER_TOKEN;
    const locked = (sendLocked || priceCents > 0) && mediaItems.length > 0;
    // Owner-set decision countdown for the incoming-media gate (seconds).
    const decideSeconds =
      role === "owner" && mediaItems.some((i) => i.type === "image" || i.type === "video")
        ? Math.max(0, Math.round(parseFloat(decideTimer.replace(/[^\d]/g, ""))) || 0)
        : 0;
    const drainCfg =
      role === "owner" && mediaItems.some((i) => i.type === "video") ? blurDrainer : null;

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
      blur_drainer: drainCfg,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, temp]);
    setText("");
    setReplyTo(null);
    setAttachments([]);
    if (usedLink) setLinkAttachment(null);
    if (locked) setSendLocked(false);
    if (priceCents > 0) setLockPrice("");
    if (decideSeconds > 0) setDecideTimer("");
    if (drainCfg) setBlurDrainer(null);

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
          decideSeconds,
          blurDrainer: drainCfg,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const { message } = data;
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          return withoutTemp.some((m) => m.id === message.id)
            ? withoutTemp
            : [...withoutTemp, message];
        });
        if (typeof data.balance === "number") setBalance(data.balance);
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
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  /** Start recording a voice note from the microphone. */
  async function startRecording() {
    if (recording || sendingVoice) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recordChunksRef.current = [];
      recordCancelRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        setRecording(false);
        if (!recordCancelRef.current && recordChunksRef.current.length > 0) {
          const type = rec.mimeType || "audio/webm";
          const ext = type.includes("mp4") ? "m4a" : "webm";
          const blob = new Blob(recordChunksRef.current, { type });
          sendVoiceNote(new File([blob], `voice-note.${ext}`, { type }));
        }
      };
      recorderRef.current = rec;
      // Timeslice so chunks arrive while recording — some browsers only
      // deliver data on stop otherwise, which can produce empty recordings.
      rec.start(500);
      setRecordSeconds(0);
      setRecording(true);
      recordTimerRef.current = setInterval(
        () => setRecordSeconds((s) => s + 1),
        1000
      );
    } catch {
      alert("Microphone unavailable — check your browser permissions.");
    }
  }

  /** Stop recording: send the note, or throw it away. */
  function stopRecording(cancel: boolean) {
    recordCancelRef.current = cancel;
    recorderRef.current?.stop();
  }

  /** Upload a recorded/attached audio file and send it as a voice note. */
  async function sendVoiceNote(file: File) {
    setSendingVoice(true);
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, scope: "chat" }),
      });
      if (!res.ok) throw new Error("Could not start the upload");
      const { path, token } = await res.json();
      const { error } = await supabaseBrowser()
        .storage.from("media")
        .uploadToSignedUrl(path, token, file, { cacheControl: "31536000" });
      if (error) throw new Error(error.message || "Upload failed");

      const mediaItems = [{ path, type: "audio" as MediaKind }];
      const tempId = `temp-${Date.now()}`;
      const temp: Message = {
        id: tempId,
        chat_id: chatId,
        sender: role,
        content: null,
        media_path: path,
        media_type: "audio",
        media_items: mediaItems,
        reply_to_id: null,
        locked: false,
        price_cents: 0,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, temp]);

      const post = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          content: "",
          mediaItems,
          mediaPath: path,
          mediaType: "audio",
        }),
      });
      if (post.ok) {
        const { message } = await post.json();
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          return withoutTemp.some((m) => m.id === message.id)
            ? withoutTemp
            : [...withoutTemp, message];
        });
      } else {
        const data = await post.json().catch(() => ({}));
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        alert(data.error || "Could not send the voice note");
      }
    } catch (err) {
      alert(
        err instanceof Error && err.message
          ? `Could not send the voice note: ${err.message}`
          : "Could not send the voice note"
      );
    }
    setSendingVoice(false);
  }

  // Instant token unlock: spends from the wallet; when the balance is short
  // the top-up sheet opens and the message is remembered for auto-accept.
  async function unlockById(messageId: string) {
    if (unlockingRef.current) return;
    unlockingRef.current = true;
    setUnlockingId(messageId);
    try {
      const res = await fetch("/api/payments/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.unlocked) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, unlocked: true, fan_decision: m.fan_decision ?? "accepted" }
              : m
          )
        );
        if (typeof data.balance === "number") setBalance(data.balance);
        pendingUnlockIdRef.current = null;
        try {
          localStorage.removeItem(`lf-decide-left:${messageId}`);
        } catch {}
      } else if (res.status === 402) {
        if (typeof data.balance === "number") setBalance(data.balance);
        pendingUnlockIdRef.current = messageId;
        openWallet(
          data.needTokens
            ? `Accepting this costs ${formatTokens(data.needTokens)} — top up to receive it.`
            : "Top up your wallet to receive this."
        );
      } else if (!res.ok) {
        alert(data.error || "Could not unlock");
      }
    } catch {
      alert("Could not unlock");
    }
    unlockingRef.current = false;
    setUnlockingId(null);
  }

  function unlockMessage(message: Message) {
    unlockById(message.id);
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
        setAttachments((prev) => {
          if (prev.some((a) => a.path === path)) return prev;
          if (prev.length >= MAX_ATTACHMENTS) return prev;
          return [...prev, { path, type }];
        });
        focusComposer();
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
    setUploading(true);
    const uploaded: { path: string; type: MediaKind }[] = [];
    let lastError: string | null = null;
    try {
      for (const file of list) {
        const kind = fileKind(file)!;
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, scope: "chat" }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          lastError = data.error || `Upload failed (${res.status})`;
          continue;
        }
        const { path, token } = await res.json();
        const { error } = await supabaseBrowser()
          .storage.from("media")
          .uploadToSignedUrl(path, token, file, { cacheControl: "31536000" });
        if (error) {
          lastError = error.message || "Upload failed";
          continue;
        }
        uploaded.push({ path, type: kind });
      }
      // Every file failed → say why instead of silently doing nothing.
      if (uploaded.length === 0 && list.length > 0) {
        alert(lastError ? `Could not upload: ${lastError}` : "Could not upload the file");
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
        focusComposer();
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function startReply(message: Message) {
    setReplyTo(message);
    focusComposer();
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
    // BlurDrainer videos reopen the control screen, not the plain lightbox.
    if (role === "guest" && parseBlurDrainer(message.blur_drainer)) {
      setDrainPlayer(message);
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
        {visibleMessages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            mine={m.sender === role}
            repliedTo={m.reply_to_id ? byId.get(m.reply_to_id) ?? null : null}
            onReply={startReply}
            onJumpToReply={jumpToReply}
            onMediaClick={openLightbox}
            onToggleLock={toggleLock}
            onUnlock={unlockMessage}
            unlocking={unlockingId === m.id}
            peerName={peerName}
            highlighted={highlightId === m.id}
            selectMode={msgSelectMode}
            selected={selectedMsgs.has(m.id)}
            onSelectToggle={toggleMsgSelected}
            onOpenBlurDrainer={
              role === "guest" ? (m) => setDrainPlayer(m) : undefined
            }
            onClaimCoupon={role === "guest" ? claimCoupon : undefined}
            claimingCoupon={claimingCouponId === m.id}
            couponRedeemed={redeemedCoupons.has(m.id)}
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
                  return replyTo.media_type === "image"
                    ? "Photo"
                    : replyTo.media_type === "audio"
                      ? "Voice note"
                      : "Video";
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
                ) : item.type === "audio" ? (
                  <div
                    className="w-14 h-14 rounded-lg bg-card border border-line flex items-center justify-center"
                    title="Voice note"
                  >
                    <IconMic className="w-5 h-5 text-accent" />
                  </div>
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
            <div className="space-y-1.5">
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
              {attachments.some((a) => a.type === "image" || a.type === "video") && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted">Decision timer</span>
                  <input
                    value={decideTimer}
                    onChange={(e) => setDecideTimer(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    placeholder="0"
                    className="w-16 bg-bg border border-line rounded-lg px-2 py-1 text-xs focus:border-accent"
                  />
                  <span className="text-xs text-muted">sec</span>
                  <span className="text-[11px] text-muted">
                    {parseInt(decideTimer, 10) > 0
                      ? "auto-rejects if they don't accept in time"
                      : "no time limit to accept"}
                  </span>
                </div>
              )}
              {attachments.some((a) => a.type === "video") && (
                <div className="flex items-center gap-2 flex-wrap rounded-xl border border-accent/30 bg-accent/5 px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => setBlurEditorOpen(true)}
                    className={`text-xs font-bold px-2.5 py-1 rounded-lg border inline-flex items-center gap-1.5 ${
                      blurDrainer
                        ? "bg-accent text-white border-accent"
                        : "bg-bg border-accent/40 text-fg"
                    }`}
                  >
                    <IconEye className="w-3.5 h-3.5" />
                    BlurDrainer
                  </button>
                  {blurDrainer ? (
                    <>
                      <span className="text-[11px] text-fg/80">
                        {blurDrainer.priceCents > 0
                          ? `${blurDrainer.layers} layers · ${formatTokens(Math.ceil(blurDrainer.priceCents / 10))}/tap`
                          : "FREE (card verify)"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setBlurDrainer(null)}
                        className="text-[11px] text-red-400 font-semibold"
                      >
                        Clear
                      </button>
                    </>
                  ) : (
                    <span className="text-[11px] text-muted">
                      Tap to place the blur · fans pay per tap to unblur
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">Add a message below, then send</p>
          )}
        </div>
      )}

      <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {cardTopup ? (
          <EmbeddedCardTopup
            clientSecret={cardTopup.clientSecret}
            amountCents={cardTopup.amountCents}
            countryGuess={cardTopup.country}
            onSuccess={completeCardTopup}
            onCancel={() => {
              pendingUnlockIdRef.current = null;
              setCardTopup(null);
            }}
          />
        ) : (
        <>
        {recording ? (
          <div className="flex items-center gap-3 bg-card2/80 border border-line2 rounded-2xl px-3 py-2 backdrop-blur">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
            <span className="text-sm font-bold tabular-nums">
              {Math.floor(recordSeconds / 60)}:
              {String(recordSeconds % 60).padStart(2, "0")}
            </span>
            <span className="flex-1 text-xs text-muted">Recording voice note…</span>
            <button
              onClick={() => stopRecording(true)}
              className="text-xs font-semibold text-muted px-2 py-1.5"
            >
              Cancel
            </button>
            <button
              onClick={() => stopRecording(false)}
              className="w-9 h-9 rounded-xl bg-accent text-white shrink-0 flex items-center justify-center active:opacity-80 transition-opacity"
              aria-label="Send voice note"
              title="Send voice note"
            >
              <IconSend className="w-4.5 h-4.5" />
            </button>
          </div>
        ) : (
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
            // Creators can also attach audio files — they send as voice notes.
            accept={role === "owner" ? "image/*,video/*,audio/*" : "image/*,video/*"}
            multiple
            hidden
            onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
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
          {role === "owner" && (
            <button
              type="button"
              onClick={() => {
                if (!attachments.some((a) => a.type === "video")) {
                  alert("Attach a video first, then set up BlurDrainer on it.");
                  fileRef.current?.click();
                  return;
                }
                setBlurEditorOpen(true);
              }}
              className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center transition-colors ${
                blurDrainer
                  ? "bg-accent text-white glow-accent"
                  : "bg-transparent border border-line text-muted hover:text-fg"
              }`}
              aria-label="BlurDrainer"
              title={
                blurDrainer
                  ? `BlurDrainer on · ${blurDrainer.layers} layers`
                  : "BlurDrainer — pay-per-tap unblur on a video"
              }
            >
              <IconEye className="w-4.5 h-4.5" />
            </button>
          )}
          {role === "owner" && (
            <button
              onClick={() =>
                setOfferDialog({ tokens: "", price: "", original: "" })
              }
              className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-sm font-bold transition-colors ${
                offerDialog
                  ? "bg-accent text-white glow-accent"
                  : "bg-transparent border border-line text-muted hover:text-fg"
              }`}
              aria-label="Send a coupon"
              title="Send this fan a one-time Token coupon"
            >
              %
            </button>
          )}
          {role === "owner" && (
            <button
              onClick={() => setPayLinkDialog({ tokens: "", price: "", url: null })}
              className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-sm font-bold transition-colors ${
                payLinkDialog
                  ? "bg-accent text-white glow-accent"
                  : "bg-transparent border border-line text-muted hover:text-fg"
              }`}
              aria-label="Create a payment link"
              title="Create a Stripe payment link (custom tokens & price, any card)"
            >
              $
            </button>
          )}
          <button
            onClick={startRecording}
            disabled={uploading || tipping || sendingVoice}
            className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center bg-transparent border border-line text-muted hover:text-fg transition-colors disabled:opacity-50"
            aria-label="Record a voice note"
            title="Record a voice note"
          >
            {sendingVoice ? (
              <span className="w-4 h-4 rounded-full border-2 border-accent/40 border-t-accent animate-spin" />
            ) : (
              <IconMic className="w-4.5 h-4.5" />
            )}
          </button>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value && tipTokens == null) notifyTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (tipTokens != null) sendTip();
                else if (!sendingRef.current) send();
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
              sending ||
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
        )}
        </>
        )}
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
            onClick={closeWallet}
          >
            <div
              className="bg-card border border-line rounded-2xl p-5 w-full max-w-sm space-y-4 fade-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold">My Tokens</p>
                <button
                  onClick={closeWallet}
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
                  const busy = toppingUp === pack.id;
                  const total = packTotalTokens(pack);
                  const highlight = pack.tag === "Most popular";
                  return (
                    <button
                      key={pack.id}
                      onClick={() => topUp(pack.id)}
                      disabled={!!toppingUp}
                      className={`relative rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-60 ${
                        highlight
                          ? "border-accent bg-accent/10"
                          : "bg-card2 border-line hover:border-accent"
                      }`}
                    >
                      {pack.tag && (
                        <span className="absolute -top-2 right-2 rounded-full bg-accent text-white text-[10px] font-bold px-2 py-0.5">
                          {pack.tag}
                        </span>
                      )}
                      <p className="text-2xl font-extrabold leading-tight tabular-nums">
                        {total.toLocaleString("en-US")}
                        <span className="text-xs font-semibold text-muted"> Tokens</span>
                      </p>
                      <p className="mt-1 text-sm font-bold text-accent">
                        {busy ? "Processing…" : perTokenLabel(pack.priceCents, total)}
                      </p>
                      {!busy && (
                        <p className="text-[10px] text-muted tabular-nums">
                          {offerPriceLabel(pack.priceCents)} total
                        </p>
                      )}
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

      {offerDialog && (
        <Portal>
          <div
            className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
            onClick={() => setOfferDialog(null)}
          >
            <div
              className="bg-card border border-line rounded-2xl p-5 w-full max-w-sm space-y-3 fade-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <p className="font-bold">Send a coupon</p>
                <p className="text-xs text-muted mt-0.5">
                  Appears as a bubble card in chat. The fan can claim it once
                  for the discounted Token pack.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted">Tokens</label>
                <input
                  autoFocus
                  inputMode="numeric"
                  value={offerDialog.tokens}
                  onChange={(e) =>
                    setOfferDialog({
                      ...offerDialog,
                      tokens: e.target.value.replace(/[^\d]/g, ""),
                    })
                  }
                  placeholder="e.g. 1300"
                  className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted">Price ($)</label>
                  <input
                    inputMode="decimal"
                    value={offerDialog.price}
                    onChange={(e) =>
                      setOfferDialog({
                        ...offerDialog,
                        price: e.target.value.replace(/[^\d.]/g, ""),
                      })
                    }
                    placeholder="4.99"
                    className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted">Was ($)</label>
                  <input
                    inputMode="decimal"
                    value={offerDialog.original}
                    onChange={(e) =>
                      setOfferDialog({
                        ...offerDialog,
                        original: e.target.value.replace(/[^\d.]/g, ""),
                      })
                    }
                    placeholder="99.99"
                    className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setOfferDialog(null)}
                  className="flex-1 rounded-xl border border-line text-sm font-semibold py-2.5"
                >
                  Cancel
                </button>
                <button
                  onClick={sendCustomOffer}
                  disabled={sendingOffer}
                  className="flex-1 rounded-xl bg-accent text-white text-sm font-semibold py-2.5 disabled:opacity-50"
                >
                  {sendingOffer ? "Sending…" : "Send coupon"}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {payLinkDialog && (
        <Portal>
          <div
            className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
            onClick={() => setPayLinkDialog(null)}
          >
            <div
              className="bg-card border border-line rounded-2xl p-5 w-full max-w-sm space-y-3 fade-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <p className="font-bold">Create a payment link</p>
                <p className="text-xs text-muted mt-0.5">
                  A Stripe checkout page for a custom token amount and price.
                  Works with any card — valid for 24 hours.
                </p>
              </div>
              {!payLinkDialog.url ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted">Tokens</label>
                      <input
                        autoFocus
                        inputMode="numeric"
                        value={payLinkDialog.tokens}
                        onChange={(e) =>
                          setPayLinkDialog({
                            ...payLinkDialog,
                            tokens: e.target.value.replace(/[^\d]/g, ""),
                          })
                        }
                        placeholder="e.g. 500"
                        className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted">Price ($)</label>
                      <input
                        inputMode="decimal"
                        value={payLinkDialog.price}
                        onChange={(e) =>
                          setPayLinkDialog({
                            ...payLinkDialog,
                            price: e.target.value.replace(/[^\d.]/g, ""),
                          })
                        }
                        placeholder="9.99"
                        className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-sm placeholder:text-muted focus:border-accent"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setPayLinkDialog(null)}
                      className="flex-1 rounded-xl border border-line text-sm font-semibold py-2.5"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={createPayLink}
                      disabled={creatingLink || !payLinkDialog.tokens || !payLinkDialog.price}
                      className="flex-1 rounded-xl bg-accent text-white text-sm font-semibold py-2.5 disabled:opacity-50"
                    >
                      {creatingLink ? "Creating…" : "Create link"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <input
                    readOnly
                    value={payLinkDialog.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full bg-card2 border border-line rounded-xl px-3 py-2.5 text-xs font-mono text-muted"
                  />
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(payLinkDialog.url!);
                          setLinkCopied(true);
                          setTimeout(() => setLinkCopied(false), 1500);
                        } catch {}
                      }}
                      className="flex-1 rounded-xl border border-line text-sm font-semibold py-2.5"
                    >
                      {linkCopied ? "Copied!" : "Copy link"}
                    </button>
                    <button
                      onClick={() => {
                        setText((prev) =>
                          prev.trim()
                            ? `${prev.trim()} ${payLinkDialog.url}`
                            : payLinkDialog.url!
                        );
                        setPayLinkDialog(null);
                      }}
                      className="flex-1 rounded-xl bg-accent text-white text-sm font-semibold py-2.5"
                    >
                      Add to message
                    </button>
                  </div>
                </>
              )}
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

      {blurEditorOpen &&
        (() => {
          const vid = attachments.find((a) => a.type === "video");
          if (!vid) return null;
          return (
            <BlurDrainerEditor
              videoPath={vid.path}
              initial={blurDrainer}
              onSave={(cfg) => {
                setBlurDrainer(cfg);
                setBlurEditorOpen(false);
              }}
              onCancel={() => setBlurEditorOpen(false)}
            />
          );
        })()}

      {pendingGate && (
        <IncomingMediaGate
          message={pendingGate}
          peerName={peerName}
          secondsLeft={gateLeft}
          busy={
            deciding ||
            unlockingId === pendingGate.id ||
            startingVerify ||
            gateCardSetup?.messageId === pendingGate.id
          }
          wizard={
            gateCardSetup && gateCardSetup.messageId === pendingGate.id ? (
              <EmbeddedCardTopup
                clientSecret={gateCardSetup.clientSecret}
                mode="setup"
                countryGuess={gateCardSetup.country}
                onSuccess={completeGateCardSetup}
                onCancel={() => setGateCardSetup(null)}
              />
            ) : null
          }
          onAccept={() => acceptGate(pendingGate)}
          onReject={() => decideGate(pendingGate, "reject")}
        />
      )}

      {drainPlayer &&
        (() => {
          const cfg = parseBlurDrainer(drainPlayer.blur_drainer);
          const video = mediaItemsFromMessage(drainPlayer).find((i) => i.type === "video");
          if (!cfg || !video) return null;
          return (
            <BlurDrainerPlayer
              videoPath={video.path}
              config={cfg}
              messageId={drainPlayer.id}
              initialCleared={drainPlayer.blur_layers_cleared ?? 0}
              onClose={() => setDrainPlayer(null)}
              onNeedTokens={(need) =>
                openWallet(
                  `You need ${formatTokens(need)} to unblur — top up to continue.`
                )
              }
              onProgress={(n) =>
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === drainPlayer.id ? { ...m, blur_layers_cleared: n } : m
                  )
                )
              }
            />
          );
        })()}

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
              ) : item.type === "audio" ? (
                <audio src={mediaUrl(item.path)} controls autoPlay className="w-80 max-w-full" />
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
