"use client";

import { useState } from "react";
import { useGuestShell } from "./GuestShellContext";
import type { SubPlan } from "@/lib/subscriptionPlan";

/**
 * Follow button for a creator profile. Following is free — the compact
 * discovery button and the full-width profile button are both plain toggles.
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
  const { refresh } = useGuestShell();

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

  const label = following
    ? small
      ? "Following"
      : "FOLLOWING"
    : small
      ? "Follow"
      : busy
        ? "…"
        : "FOLLOW FOR FREE";

  return (
    <div className="space-y-1.5">
      <button
        onClick={toggleFollow}
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
      {!small && !following && (
        <p className="text-xs text-muted text-center">Free to follow</p>
      )}
    </div>
  );
}
