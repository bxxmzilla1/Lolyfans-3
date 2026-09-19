"use client";

import { useState } from "react";
import { openCreatorChat } from "@/lib/openCreatorChat";
import { useNavigate } from "@/lib/navPending";

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
  const { run } = useNavigate();
  const [busy, setBusy] = useState(false);

  async function open() {
    if (busy) return;
    setBusy(true);
    await run(() => openCreatorChat(ownerId));
    setBusy(false);
  }

  return (
    <button type="button" onClick={open} disabled={busy} className={className}>
      Message
    </button>
  );
}
