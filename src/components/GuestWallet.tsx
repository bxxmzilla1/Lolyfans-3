"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TOKEN_PACKS,
  FIRST_TOPUP_OFFER_PACK_ID,
  formatTokens,
  packPriceLabel,
  packTotalTokens,
} from "@/lib/tokens";
import {
  DEFAULT_POPUP_OFFER,
  offerPriceLabel,
  type PopupOffer,
} from "@/lib/popupOffer";
import { mediaUrl } from "@/lib/utils";
import GuestProfileEditor from "./GuestProfileEditor";
import {
  IconBack,
  IconChevronRight,
  IconTip,
  IconUser,
} from "./Icons";

type HistoryEntry = {
  id: string;
  amount: number;
  kind: "topup" | "unlock" | "tip";
  createdAt: string;
  priceCents: number | null;
};

const KIND_LABEL: Record<HistoryEntry["kind"], string> = {
  topup: "Token top-up",
  unlock: "Content unlock",
  tip: "Tip sent",
};

function priceLabel(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Fan Wallet tab: balance card up top, token packs to top up, purchase
 * history, and the account screen (name / picture / logout) demoted behind
 * a small row at the bottom.
 */
export default function GuestWallet({
  profileName,
  profileAvatarPath,
}: {
  profileName: string;
  profileAvatarPath: string | null;
}) {
  const [view, setView] = useState<"wallet" | "account">("wallet");
  const [chatId, setChatId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [toppingUp, setToppingUp] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // One-time offer: fans who never topped up get the VIP pack at the
  // creator's configured offer price.
  const [firstOffer, setFirstOffer] = useState(false);
  const [offer, setOffer] = useState<PopupOffer>(DEFAULT_POPUP_OFFER);
  const packsRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/guest/wallet");
      if (res.ok) {
        const data = await res.json();
        setChatId(data.chatId ?? null);
        if (typeof data.balance === "number") setBalance(data.balance);
        setHistory(data.history ?? []);
        setFirstOffer(!!data.firstTopupOffer);
        if (data.offer) setOffer(data.offer);
      }
    } catch {
      // Offline — the card shows a placeholder until the next refresh.
    }
    setLoading(false);
  }, []);

  // Returning from Stripe Checkout: confirm the session (covers webhook
  // failures) before loading, so the fresh tokens are already in the balance.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const paid = params.get("topup");
    if (sessionId || paid) {
      window.history.replaceState({}, "", "/profile");
      (async () => {
        if (sessionId) {
          await fetch("/api/payments/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          }).catch(() => {});
          setNote("Tokens added to your wallet 🎉");
        }
        refresh();
      })();
      return;
    }
    refresh();
  }, [refresh]);

  /** Buy a pack: one tap with a saved card, Stripe Checkout otherwise. */
  async function topUp(packId: string) {
    if (toppingUp || !chatId) return;
    setToppingUp(packId);
    setNote(null);
    try {
      const res = await fetch("/api/payments/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, packId, returnTo: "profile" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.topped) {
        if (typeof data.balance === "number") setBalance(data.balance);
        setNote(`+${formatTokens(data.tokens ?? 0)} added to your wallet 🎉`);
        refresh();
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

  if (view === "account") {
    return (
      <div>
        <button
          onClick={() => setView("wallet")}
          className="flex items-center gap-1.5 px-4 pt-4 text-sm font-semibold text-accent"
        >
          <IconBack className="w-4.5 h-4.5" />
          Wallet
        </button>
        <GuestProfileEditor
          initialName={profileName}
          initialAvatarPath={profileAvatarPath}
        />
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-6">
      {/* Balance card */}
      <div className="rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/15 to-accent/5 p-5">
        <div className="flex items-center gap-2 text-muted">
          <span className="w-7 h-7 rounded-full bg-accent/15 text-accent flex items-center justify-center">
            <IconTip className="w-4 h-4" />
          </span>
          <p className="text-xs font-semibold uppercase tracking-wide">
            Token balance
          </p>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <p className="text-4xl font-extrabold tabular-nums leading-none">
            {loading && balance === null ? (
              <span className="text-muted">···</span>
            ) : (
              <>
                {(balance ?? 0).toLocaleString("en-US")}
                <span className="text-base font-semibold text-muted"> Tokens</span>
              </>
            )}
          </p>
          <button
            onClick={() =>
              packsRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              })
            }
            className="shrink-0 rounded-full bg-accent text-white text-sm font-bold px-5 py-2.5 active:opacity-80 transition-opacity"
          >
            Top up
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted">Spend on unlocks & tips</p>
      </div>

      {note && <p className="text-sm text-accent font-semibold">{note}</p>}

      {/* Token packs */}
      <section ref={packsRef} className="space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Token packs
        </p>
        <div className="grid grid-cols-2 gap-2">
          {TOKEN_PACKS.map((pack) => {
            const busy = toppingUp === pack.id;
            // First-purchase offer: the VIP pack takes the highlight
            // (and a pulse) away from "Most popular", showing the
            // creator's configured tokens and prices.
            const isOffer = firstOffer && pack.id === FIRST_TOPUP_OFFER_PACK_ID;
            const total = isOffer ? offer.tokens : packTotalTokens(pack);
            const bonus = isOffer
              ? Math.max(0, offer.tokens - pack.tokens)
              : pack.bonusTokens;
            const highlight = isOffer || (pack.tag === "Most popular" && !firstOffer);
            return (
              <button
                key={pack.id}
                onClick={() => topUp(pack.id)}
                disabled={!!toppingUp || !chatId}
                className={`relative rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-60 ${
                  highlight
                    ? "border-accent bg-accent/10"
                    : "bg-card2 border-line hover:border-accent"
                } ${isOffer ? "offer-pulse" : ""}`}
              >
                {(isOffer || pack.tag) && (
                  <span className="absolute -top-2 right-2 rounded-full bg-accent text-white text-[10px] font-bold px-2 py-0.5">
                    {isOffer ? "One-time offer" : pack.tag}
                  </span>
                )}
                <p className="text-base font-extrabold tabular-nums">
                  {total.toLocaleString("en-US")}
                  <span className="text-xs font-semibold text-muted"> Tokens</span>
                </p>
                {bonus > 0 && (
                  <p className="text-[11px] font-semibold text-emerald-500">
                    incl. +{bonus.toLocaleString("en-US")} free
                  </p>
                )}
                <p className="mt-1 text-sm font-bold text-accent">
                  {busy ? (
                    "Processing…"
                  ) : isOffer ? (
                    <>
                      {offerPriceLabel(offer.priceCents)}{" "}
                      <span className="text-[11px] font-semibold text-muted line-through">
                        {offerPriceLabel(offer.originalCents)}
                      </span>
                    </>
                  ) : (
                    packPriceLabel(pack)
                  )}
                </p>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted text-center">
          One-tap with your saved card · secured by Stripe
        </p>
        <p className="text-[11px] text-muted/80 text-center">
          All Token purchases are final and non-refundable.
        </p>
      </section>

      {/* Purchase history */}
      <section className="space-y-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">
          Purchase history
        </p>
        {loading && history.length === 0 ? (
          <p className="text-sm text-muted px-1 py-2">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted px-1 py-2">
            No purchases yet — your top-ups and unlocks will show up here.
          </p>
        ) : (
          <div className="rounded-2xl border border-line2 bg-card divide-y divide-line2">
            {history.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {KIND_LABEL[t.kind]}
                  </p>
                  <p className="text-[11px] text-muted">{dateLabel(t.createdAt)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p
                    className={`text-sm font-bold tabular-nums ${
                      t.amount > 0 ? "text-emerald-500" : "text-fg"
                    }`}
                  >
                    {t.amount > 0 ? "+" : "−"}
                    {Math.abs(t.amount).toLocaleString("en-US")}{" "}
                    <span className="text-xs font-semibold text-muted">Tokens</span>
                  </p>
                  {t.priceCents !== null && (
                    <p className="text-[11px] text-muted tabular-nums">
                      {priceLabel(t.priceCents)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Account (name / picture / logout), demoted one level */}
      <section className="border-t border-line pt-4">
        <button
          onClick={() => setView("account")}
          className="w-full flex items-center gap-3 rounded-2xl border border-line2 bg-card px-4 py-3 hover:bg-card2 transition-colors"
        >
          {profileAvatarPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl(profileAvatarPath)}
              alt={profileName}
              className="w-9 h-9 rounded-full object-cover bg-bg shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-card2 flex items-center justify-center shrink-0">
              <IconUser className="w-4.5 h-4.5 text-muted" />
            </div>
          )}
          <span className="flex-1 min-w-0 text-left">
            <span className="block text-sm font-semibold truncate">Account</span>
            <span className="block text-[11px] text-muted truncate">
              {profileName} · picture, name & log out
            </span>
          </span>
          <IconChevronRight className="w-4.5 h-4.5 text-muted shrink-0" />
        </button>
      </section>
    </div>
  );
}
