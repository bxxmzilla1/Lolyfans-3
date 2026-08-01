"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import IncomingMediaGate from "./IncomingMediaGate";
import EmbeddedCardTopup from "./EmbeddedCardTopup";
import { parseBlurDrainer } from "@/lib/blurDrainer";
import { useInboxSignals, type ChatOwnerPair } from "@/lib/useInboxSignals";
import type { Message } from "./MessageBubble";

type Pending = {
  message: Message;
  peerName: string;
  chatId: string;
  hasCard: boolean;
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
  const [startingSetup, setStartingSetup] = useState(false);
  const [gateLeft, setGateLeft] = useState<number | null>(null);
  const [gateCardSetup, setGateCardSetup] = useState<{
    clientSecret: string;
    country: string | null;
    messageId: string;
    chatId: string;
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

  useInboxSignals(pairs, loadPending);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadPending();
    }, 5000);
    return () => clearInterval(timer);
  }, [loadPending]);

  const message = pending?.message ?? null;
  const gatePaused =
    deciding ||
    startingSetup ||
    unlockingId === message?.id ||
    (!!gateCardSetup && gateCardSetup.messageId === message?.id);

  const decideGate = useCallback(
    async (msg: Message, decision: "accept" | "reject", chatId?: string) => {
      if (deciding) return false;
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
          setGateCardSetup(null);
          if (decision === "accept" && chatId) {
            await goToChat(chatId);
          } else {
            await loadPending();
          }
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
    [deciding, loadPending, goToChat]
  );

  async function unlockById(messageId: string, chatId: string) {
    if (unlockingId) return;
    setUnlockingId(messageId);
    try {
      const res = await fetch("/api/payments/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.unlocked) {
        try {
          localStorage.removeItem(`lf-decide-left:${messageId}`);
        } catch {}
        setPending(null);
        await goToChat(chatId);
      } else if (res.status === 402) {
        // Not enough Tokens — open the chat wallet so they can top up, then
        // the pending unlock resumes after purchase.
        try {
          sessionStorage.setItem("lf-pending-unlock", messageId);
          sessionStorage.setItem(
            "lf-open-wallet-note",
            data.needTokens
              ? `Accepting this costs ${Number(data.needTokens).toLocaleString("en-US")} Tokens — top up to receive it.`
              : "Top up your wallet to unlock this content."
          );
        } catch {}
        setPending(null);
        await goToChat(chatId);
      } else if (!res.ok) {
        alert(data.error || "Could not unlock");
      }
    } catch {
      alert("Could not unlock");
    }
    setUnlockingId(null);
  }

  async function startGateCardSetup(messageId: string, chatId: string) {
    if (startingSetup || gateCardSetup) return;
    setStartingSetup(true);
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
          chatId,
        });
      } else {
        alert(data.error || "Could not start card setup");
      }
    } catch {
      alert("Could not start card setup");
    }
    setStartingSetup(false);
  }

  async function completeGateCardSetup(setupIntentId: string) {
    const chatId = gateCardSetup?.chatId;
    const messageId = gateCardSetup?.messageId;
    try {
      await fetch("/api/payments/verify/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, setupIntentId }),
      });
    } catch {
      // Card already saved on Stripe.
    }
    setGateCardSetup(null);
    const msg = pending?.message;
    if (msg && messageId === msg.id && chatId) {
      await decideGate(msg, "accept", chatId);
    }
  }

  function acceptGate(msg: Message, chatId: string) {
    // BlurDrainer: accept with or without a card. The Stripe card form appears
    // inside the player on the first tap of the blur layer.
    if (parseBlurDrainer(msg.blur_drainer)) {
      decideGate(msg, "accept", chatId);
      return;
    }
    if ((msg.price_cents ?? 0) > 0 && msg.locked && !msg.unlocked) {
      unlockById(msg.id, chatId);
    } else {
      decideGate(msg, "accept", chatId);
    }
  }

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
      busy={
        deciding ||
        startingSetup ||
        unlockingId === pending.message.id ||
        !!gateCardSetup
      }
      wizard={
        gateCardSetup && gateCardSetup.messageId === pending.message.id ? (
          <EmbeddedCardTopup
            clientSecret={gateCardSetup.clientSecret}
            mode="setup"
            countryGuess={gateCardSetup.country}
            onSuccess={completeGateCardSetup}
            onCancel={() => setGateCardSetup(null)}
          />
        ) : null
      }
      onAccept={() => acceptGate(pending.message, pending.chatId)}
      onReject={() => decideGate(pending.message, "reject")}
    />
  );
}
