"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconSend } from "./Icons";

/**
 * Opens a Chat-per-minute fan's Telegram DM in the inbox. First use asks for
 * their @username and saves it on the chat.
 */
export default function CpmTelegramDmButton({
  chatId,
  name,
  initialPeer,
}: {
  chatId: string;
  name: string;
  initialPeer?: string | null;
}) {
  const router = useRouter();
  const [peer, setPeer] = useState(initialPeer ?? null);
  const [busy, setBusy] = useState(false);

  async function open() {
    let next = peer;
    if (!next) {
      const typed = window.prompt(`Telegram @username for ${name}`, "");
      if (!typed?.trim()) return;
      setBusy(true);
      try {
        const res = await fetch("/api/cpm/telegram-dm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, peer: typed.trim() }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.peer) {
          window.alert(data.error || "Could not link Telegram");
          return;
        }
        next = data.peer as string;
        setPeer(next);
      } catch {
        window.alert("Could not link Telegram");
        return;
      } finally {
        setBusy(false);
      }
    }
    if (next) router.push(`/inbox/tg/${encodeURIComponent(next)}`);
  }

  return (
    <button
      type="button"
      aria-label={`Message ${name} on Telegram`}
      title={peer ? "Open Telegram DM" : "Link Telegram & open DM"}
      disabled={busy}
      onClick={() => void open()}
      className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[#2AABEE] hover:bg-[#2AABEE]/15 disabled:opacity-50"
    >
      {busy ? (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-[#2AABEE]/40 border-t-[#2AABEE] animate-spin" />
      ) : (
        <IconSend className="w-4 h-4" />
      )}
    </button>
  );
}
