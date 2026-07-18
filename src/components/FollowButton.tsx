"use client";

import { useState } from "react";
import { useGuestShell } from "./GuestShellContext";

/**
 * Subscribe/unsubscribe (follow under the hood) to a creator; optimistic so
 * it feels instant. Full-size shows the OnlyFans-style split label —
 * "Subscribe" left, "Free" right — and flips to "Subscribed" once active.
 */
export default function FollowButton({
  ownerId,
  initialFollowing,
  small,
}: {
  ownerId: string;
  initialFollowing: boolean;
  small?: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const { refresh } = useGuestShell();

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
      if (!res.ok) setFollowing(!next);
      else refresh();
    } catch {
      setFollowing(!next);
    }
    setBusy(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`${small ? "px-3.5 py-1.5 text-xs" : "px-6 py-2.5 text-sm"} rounded-full font-semibold transition-colors ${
        following
          ? "bg-card2 border border-line2 text-fg"
          : "bg-accent text-white"
      }`}
    >
      {following ? (
        "Subscribed"
      ) : small ? (
        "Subscribe"
      ) : (
        <span className="flex items-center justify-between gap-8">
          <span>Subscribe</span>
          <span>Free</span>
        </span>
      )}
    </button>
  );
}
