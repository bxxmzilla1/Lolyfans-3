"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { openCreatorChat } from "@/lib/openCreatorChat";

/**
 * "Message" action for a creator: switches the fan's session to their chat
 * with THIS creator (not whichever chat was open last) and opens it.
 */
export default function MessageCreatorButton({
  ownerId,
  className,
}: {
  ownerId: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function open() {
    if (busy) return;
    setBusy(true);
    router.push(await openCreatorChat(ownerId));
    setBusy(false);
  }

  return (
    <button type="button" onClick={open} disabled={busy} className={className}>
      {busy ? "…" : "Message"}
    </button>
  );
}
