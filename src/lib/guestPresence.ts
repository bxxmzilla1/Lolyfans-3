import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * One shared realtime presence channel per owner that tracks which guests
 * currently have their chat page open. Guests track themselves (keyed by chat
 * id); the owner's UI (sidebar dots + chat header) subscribes read-only.
 *
 * Shared so the sidebar and the open chat header — both mounted at once — don't
 * each open a duplicate channel for the same topic.
 */

let channel: RealtimeChannel | null = null;
let channelOwner: string | null = null;
let onlineIds = new Set<string>();
const listeners = new Set<(ids: Set<string>) => void>();

function topicFor(ownerId: string) {
  return `presence:owner:${ownerId}:guests`;
}

function emit() {
  const snapshot = new Set(onlineIds);
  listeners.forEach((l) => l(snapshot));
}

function ensureChannel(ownerId: string) {
  if (channel && channelOwner === ownerId) return;
  const supabase = supabaseBrowser();
  if (channel) supabase.removeChannel(channel);
  channelOwner = ownerId;
  channel = supabase.channel(topicFor(ownerId));

  const refresh = () => {
    const state = channel!.presenceState<{ chatId?: string }>();
    const ids = new Set<string>();
    for (const key of Object.keys(state)) {
      for (const entry of state[key]) {
        if (entry.chatId) ids.add(entry.chatId);
      }
    }
    onlineIds = ids;
    emit();
  };

  channel
    .on("presence", { event: "sync" }, refresh)
    .on("presence", { event: "join" }, refresh)
    .on("presence", { event: "leave" }, refresh)
    .subscribe();
}

/** Owner side: watch which guest chats are online. Returns an unsubscribe fn. */
export function subscribeGuestPresence(
  ownerId: string,
  cb: (ids: Set<string>) => void
): () => void {
  ensureChannel(ownerId);
  listeners.add(cb);
  cb(new Set(onlineIds));
  return () => {
    listeners.delete(cb);
  };
}

/** Guest side: announce presence on the owner's channel while the chat is open. */
export function trackGuestPresence(ownerId: string, chatId: string): () => void {
  const supabase = supabaseBrowser();
  const track = supabase.channel(topicFor(ownerId), {
    config: { presence: { key: chatId } },
  });
  track.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await track.track({ chatId, online_at: new Date().toISOString() });
    }
  });
  return () => {
    supabase.removeChannel(track);
  };
}
