"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Message" action for a creator: opens their private Telegram channel when
 * one is configured (and this fan has access). Without a channel, it falls
 * back to the creator's profile page.
 */
export default function MessageCreatorButton({
  ownerId,
  className,
}: {
  ownerId: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function open() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/payments/subscribe/link?ownerId=${ownerId}`);
      const json = (await res.json().catch(() => ({}))) as {
        link?: string | null;
      };
      if (res.ok && json.link) {
        window.location.href = json.link;
        return;
      }
    } catch {
      // fall through to the profile page
    }
    setBusy(false);
    router.push(`/p/${ownerId}`);
  }

  return (
    <button type="button" onClick={open} disabled={busy} className={className}>
      {busy ? "Opening…" : "Message"}
    </button>
  );
}
