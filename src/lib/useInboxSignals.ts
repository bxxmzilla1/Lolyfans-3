"use client";

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export type ChatOwnerPair = { chatId: string; ownerId: string };

/**
 * Live "something happened in your chats" signal for guests. Every message
 * send already broadcasts a `new-message` event on the sender's inbox topic —
 * this subscribes to the topics of the creators the guest chats with and
 * fires the handler when an event concerns one of the guest's own chats, so
 * unread badges update instantly instead of waiting for a poll.
 */
export function useInboxSignals(pairs: ChatOwnerPair[], onSignal: () => void) {
  const handlerRef = useRef(onSignal);
  handlerRef.current = onSignal;
  const chatIdsRef = useRef<Set<string>>(new Set());
  chatIdsRef.current = new Set(pairs.map((p) => p.chatId));

  // Stable key so we only resubscribe when the set of creators changes.
  const key = [...new Set(pairs.map((p) => p.ownerId))].sort().join(",");

  useEffect(() => {
    if (!key) return;
    const supabase = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Coalesce bursts (e.g. a mass message hitting several chats at once)
    // into one refresh.
    const fire = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        handlerRef.current();
      }, 600);
    };
    const channels = key.split(",").map((ownerId) =>
      supabase
        .channel(`inbox:${ownerId}`)
        .on("broadcast", { event: "new-message" }, ({ payload }) => {
          const chatId = (payload as { chatId?: string } | null)?.chatId;
          if (chatId && chatIdsRef.current.has(chatId)) fire();
        })
        .subscribe()
    );
    return () => {
      if (timer) clearTimeout(timer);
      channels.forEach((c) => supabase.removeChannel(c));
    };
  }, [key]);
}
