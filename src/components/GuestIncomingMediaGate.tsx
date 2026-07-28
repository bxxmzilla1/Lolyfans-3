"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import IncomingMediaGate from "./IncomingMediaGate";
import EmbeddedCardTopup from "./EmbeddedCardTopup";
import { elementsEnabled } from "@/lib/stripeClient";
import { useInboxSignals, type ChatOwnerPair } from "@/lib/useInboxSignals";
import type { Message } from "./MessageBubble";

type Pending = {
  message: Message;
  peerName: string;
  chatId: string;
};

/**
 * Fullscreen Accept/Reject gate for creator photos/videos while the fan is
 * browsing the Home shell (also Chats / Profile). ChatView handles the same
 * flow when /chat is open; this covers everywhere else in the fan footer.
 * Accepting from here opens that creator's chat so the media lands in context.
 */
export default function GuestIncomingMediaGate({
  pairs,
}: {
  pairs: ChatOwnerPair[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [gateLeft, setGateLeft] = useState<number | null>(null);
  const [cardUnlock, setCardUnlock] = useState<{
    clientSecret: string;
    amountCents: number;
    messageId: string;
    chatId: string;
    country: string | null;
  } | null>(null);
  const gateIdRef = useRef<string | null>(null);
  const fetchingRef = useRef(false);

  const loadPending = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res = await fetch("/api/guest/pending-media");
      if (!res.ok) return;
      const data = await res.json();
      setPending(data.pending ?? null);
    } catch {
      // Keep whatever we already have; a later signal will retry.
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  /** Point the session at this chat and open it (same path as the chat list). */
  const goToChat = useCallback(
    async (chatId: string) => {
      try {
        await fetch("/api/guest/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId }),
        });
      } catch {
        // Still navigate — /chat will use whatever session chat is active.
      }
      router.push("/chat");
    },
    [router]
  );

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  // Creator sent media in any of this fan's chats — pull the gate immediately.
  useInboxSignals(pairs, loadPending);

  // Keep the Home gate in sync every second (accept/decline from chat, timer
  // expiry in another tab, etc.) while this tab is visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadPending();
    }, 1000);
    return () => clearInterval(timer);
  }, [loadPending]);

  const message = pending?.message ?? null;
  const gatePaused =
    deciding ||
    unlockingId === message?.id ||
    (!!cardUnlock && cardUnlock.messageId === message?.id);

  const decideGate = useCallback(
    async (msg: Message, decision: "accept" | "reject", chatId?: string) => {
      if (deciding) return;
      setDeciding(true);
      try {
        const res = await fetch("/api/messages/decide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: msg.id, decision }),
        });
        if (res.ok) {
          try {
            localStorage.removeItem(`lf-decide-left:${msg.id}`);
          } catch {}
          setPending(null);
          if (decision === "accept" && chatId) {
            await goToChat(chatId);
          } else {
            // Reject stays on Home; next undecided media (if any) takes over.
            await loadPending();
          }
        } else {
          const data = await res.json().catch(() => ({}));
          alert(data.error || "Something went wrong — try again");
        }
      } catch {
        alert("Something went wrong — try again");
      }
      setDeciding(false);
    },
    [deciding, loadPending, goToChat]
  );

  async function unlockById(messageId: string, chatId: string) {
    if (unlockingId) return;
    setUnlockingId(messageId);
    try {
      const res = await fetch("/api/payments/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, embedded: elementsEnabled() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.unlocked) {
        try {
          localStorage.removeItem(`lf-decide-left:${messageId}`);
        } catch {}
        setPending(null);
        await goToChat(chatId);
      } else if (res.ok && data.clientSecret) {
        setCardUnlock({
          clientSecret: data.clientSecret,
          amountCents: Number(data.amountCents ?? 0),
          messageId,
          chatId,
          country: data.country ?? null,
        });
      } else if (res.ok && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      } else if (!res.ok) {
        alert(data.error || "Could not unlock");
      }
    } catch {
      alert("Could not unlock");
    }
    setUnlockingId(null);
  }

  function acceptGate(msg: Message, chatId: string) {
    if ((msg.price_cents ?? 0) > 0 && msg.locked && !msg.unlocked) {
      unlockById(msg.id, chatId);
    } else {
      decideGate(msg, "accept", chatId);
    }
  }

  async function completeCardUnlock(paymentIntentId: string) {
    const chatId = cardUnlock?.chatId;
    const messageId = cardUnlock?.messageId;
    try {
      await fetch("/api/payments/unlock/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, paymentIntentId }),
      });
    } catch {
      // Webhook still records the unlock.
    }
    setCardUnlock(null);
    if (messageId) {
      try {
        localStorage.removeItem(`lf-decide-left:${messageId}`);
      } catch {}
    }
    setPending(null);
    if (chatId) await goToChat(chatId);
  }

  // Restore / start the creator-set countdown for the current gate message.
  useEffect(() => {
    const id = message?.id ?? null;
    if (gateIdRef.current === id) return;
    gateIdRef.current = id;
    if (!message || !(message.decide_seconds && message.decide_seconds > 0)) {
      setGateLeft(null);
      return;
    }
    let left = message.decide_seconds;
    try {
      const saved = parseInt(
        localStorage.getItem(`lf-decide-left:${message.id}`) ?? "",
        10
      );
      if (Number.isFinite(saved) && saved >= 0 && saved < left) left = saved;
    } catch {}
    setGateLeft(left);
  }, [message]);

  useEffect(() => {
    if (gateLeft === null || !message || gatePaused) return;
    if (gateLeft <= 0) {
      decideGate(message, "reject");
      return;
    }
    const t = setTimeout(() => {
      setGateLeft((s) => {
        const next = s === null ? null : Math.max(0, s - 1);
        if (next !== null) {
          try {
            localStorage.setItem(`lf-decide-left:${message.id}`, String(next));
          } catch {}
        }
        return next;
      });
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateLeft, gatePaused, message?.id]);

  if (!pending) return null;

  return (
    <IncomingMediaGate
      message={pending.message}
      peerName={pending.peerName}
      secondsLeft={gateLeft}
      busy={deciding || unlockingId === pending.message.id}
      wizard={
        cardUnlock && cardUnlock.messageId === pending.message.id ? (
          <EmbeddedCardTopup
            clientSecret={cardUnlock.clientSecret}
            amountCents={cardUnlock.amountCents}
            label="Unlock content"
            countryGuess={cardUnlock.country}
            onSuccess={completeCardUnlock}
            onCancel={() => setCardUnlock(null)}
          />
        ) : null
      }
      onAccept={() => acceptGate(pending.message, pending.chatId)}
      onReject={() => decideGate(pending.message, "reject")}
    />
  );
}
