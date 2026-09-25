"use client";

import { useEffect, useRef, useState } from "react";
import { deviceTraits } from "@/lib/deviceTraits";
import { trackLead, trackSignup } from "@/lib/metaPixel";

/**
 * Invite links with sign-up turned off: starts the visitor's chat in the
 * background (no form) and drops them into it. Paid profiles still go
 * through the card step.
 */
export default function QuickChatStart({ code, ownerId }: { code: string; ownerId: string }) {
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const res = await fetch("/api/guest/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, traits: deviceTraits() }),
      }).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (!res?.ok || !data?.ok) {
        setError(data?.error || "Couldn't open the chat. Please refresh.");
        return;
      }
      if (data.created) trackSignup("quick_link");
      if (data.requiresCard) {
        window.location.replace(`/p/${ownerId}?subscribe=1`);
        return;
      }
      if (data.created) trackLead(data.plan, "quick_link");
      window.location.replace("/chat");
    })();
  }, [code, ownerId]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-bg/80 backdrop-blur-sm">
      {error ? (
        <p className="text-sm text-red-500 px-6 text-center">{error}</p>
      ) : (
        <>
          <span className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <p className="text-sm text-muted">Opening chat…</p>
        </>
      )}
    </div>
  );
}
