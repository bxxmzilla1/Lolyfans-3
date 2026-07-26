"use client";

import { useState } from "react";

/**
 * Owner chat header switch: how the creator appears to THIS fan — online
 * (green, the default) or offline (gray). Only affects the current chat;
 * the fan's header updates live via the broadcast from the API.
 */
export default function OwnerOnlineSwitch({
  chatId,
  initialOnline,
}: {
  chatId: string;
  initialOnline: boolean;
}) {
  const [online, setOnline] = useState(initialOnline);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    if (saving) return;
    const next = !online;
    setOnline(next);
    setSaving(true);
    try {
      const res = await fetch("/api/chats/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, online: next }),
      });
      if (!res.ok) setOnline(!next);
    } catch {
      setOnline(!next);
    }
    setSaving(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={saving}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        online
          ? "border-green-500/40 bg-green-500/10 text-green-500"
          : "border-line bg-card2 text-muted"
      }`}
      title={
        online
          ? "This fan sees you as online — tap to appear offline to them"
          : "This fan sees you as offline — tap to appear online to them"
      }
      aria-label="Toggle how you appear to this fan"
    >
      <span
        className={`w-2 h-2 rounded-full ${online ? "bg-green-500" : "bg-muted"}`}
      />
      {online ? "Online" : "Offline"}
    </button>
  );
}
