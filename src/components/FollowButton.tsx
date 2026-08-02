"use client";

import { useEffect, useState } from "react";
import { useGuestShell } from "./GuestShellContext";
import type { SubPlan } from "@/lib/subscriptionPlan";

/**
 * Join / follow button for a creator profile. Channel access is free — the
 * full button opens the Telegram channel after following; the compact
 * discovery button is a plain follow toggle.
 */
export default function FollowButton({
  ownerId,
  initialFollowing,
  small,
  full,
}: {
  ownerId: string;
  ownerName?: string;
  initialFollowing: boolean;
  small?: boolean;
  full?: boolean;
  plan?: SubPlan | null;
  initialSubscribed?: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const [tgLink, setTgLink] = useState<string | null>(null);
  const { refresh } = useGuestShell();

  async function fetchTelegramLink(): Promise<string | null> {
    try {
      const res = await fetch(`/api/payments/subscribe/link?ownerId=${ownerId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.link === "string" && data.link) {
        setTgLink(data.link);
        return data.link as string;
      }
    } catch {}
    return null;
  }

  useEffect(() => {
    if (small) return;
    if (following) void fetchTelegramLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, small]);

  async function toggleFollow() {
    if (busy) return;
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      const res = await fetch("/api/guest/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, follow: next }),
      });
      if (!res.ok) setFollowing(!next);
      else refresh();
    } catch {
      setFollowing(!next);
    }
    setBusy(false);
  }

  async function joinFree() {
    if (busy) return;
    if (!following) await toggleFollow();
    const link = tgLink || (await fetchTelegramLink());
    if (link) {
      window.location.href = link;
      return;
    }
  }

  async function openOrUnfollow() {
    if (busy) return;
    const link = tgLink || (await fetchTelegramLink());
    if (link) {
      window.location.href = link;
      return;
    }
    await toggleFollow();
  }

  const onClick = small
    ? toggleFollow
    : following
      ? openOrUnfollow
      : joinFree;

  const label = following
    ? small
      ? "Following"
      : tgLink
        ? "OPEN TELEGRAM CHANNEL"
        : "Following"
    : small
      ? "JOIN"
      : busy
        ? "…"
        : "JOIN PRIVATE TELEGRAM CHANNEL";

  const button = (
    <button
      onClick={onClick}
      disabled={busy}
      className={`${
        small
          ? "px-3.5 py-1.5 text-xs"
          : full
            ? "w-full px-5 py-3 text-sm"
            : "px-6 py-2.5 text-sm min-w-48"
      } rounded-full font-semibold transition-colors disabled:opacity-60 ${
        following
          ? "bg-card2 border border-line2 text-fg"
          : "bg-accent text-white"
      }`}
    >
      {label}
    </button>
  );

  if (small || following) {
    return (
      <div className="space-y-1.5">
        {button}
        {!small && !following && (
          <p className="text-xs text-muted text-center">Free to join</p>
        )}
        {!small && following && tgLink && (
          <button
            onClick={toggleFollow}
            disabled={busy}
            className="w-full text-center text-xs text-muted hover:text-fg transition-colors disabled:opacity-50"
          >
            Leave
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {button}
      <p className="text-xs text-muted text-center">Free to join</p>
    </div>
  );
}
