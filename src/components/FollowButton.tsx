"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGuestShell } from "./GuestShellContext";

/**
 * Subscribe/unsubscribe (follow under the hood) to a creator; optimistic so
 * it feels instant. Shows the OnlyFans-style split label — "SUBSCRIBE" left,
 * "FREE" right — and flips to "Subscribed" once active. `wide` renders the
 * full-width variant used on locked profiles (same look as the invite
 * preview's button).
 */
export default function FollowButton({
  ownerId,
  initialFollowing,
  small,
  wide,
}: {
  ownerId: string;
  initialFollowing: boolean;
  small?: boolean;
  wide?: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const { refresh } = useGuestShell();
  const router = useRouter();

  async function toggle() {
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
      if (!res.ok) {
        setFollowing(!next);
      } else {
        refresh();
        // Re-render the server page so locked/unlocked state (blurred posts,
        // Message button) updates immediately.
        router.refresh();
      }
    } catch {
      setFollowing(!next);
    }
    setBusy(false);
  }

  const size = small
    ? "px-3.5 py-1.5 text-xs"
    : wide
      ? "w-full py-3.5 px-6 text-base"
      : "px-6 py-2.5 text-sm min-w-48";

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`${size} rounded-full font-semibold transition-colors ${
        following
          ? "bg-card2 border border-line2 text-fg"
          : "bg-accent text-white"
      }`}
    >
      {following ? (
        "Subscribed"
      ) : small ? (
        "SUBSCRIBE"
      ) : (
        <span className="flex items-center justify-between gap-8">
          <span>SUBSCRIBE</span>
          <span>FREE</span>
        </span>
      )}
    </button>
  );
}
