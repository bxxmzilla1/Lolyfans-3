import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * One shared realtime presence channel per owner that tracks which guests
 * currently have the app open. Guests track themselves (keyed by chat id);
 * the owner's UI (sidebar dots + chat header) subscribes read-only.
 *
 * Both sides self-heal: when the websocket drops (phone lock, network switch,
 * laptop sleep) the channel is resubscribed automatically, so online/offline
 * stays live without ever refreshing the page.
 */

let channel: RealtimeChannel | null = null;
let channelOwner: string | null = null;
let onlineIds = new Set<string>();
const listeners = new Set<(ids: Set<string>) => void>();
let ownerRetry: ReturnType<typeof setTimeout> | null = null;
let ownerWired = false;

function topicFor(ownerId: string) {
  return `presence:owner:${ownerId}:guests`;
}

function emit() {
  const snapshot = new Set(onlineIds);
  listeners.forEach((l) => l(snapshot));
}

function connectOwnerChannel() {
  if (!channelOwner) return;
  const supabase = supabaseBrowser();
  if (channel) supabase.removeChannel(channel);

  const ch = supabase.channel(topicFor(channelOwner));
  channel = ch;

  const refresh = () => {
    if (channel !== ch) return;
    const state = ch.presenceState<{ chatId?: string }>();
    const ids = new Set<string>();
    for (const key of Object.keys(state)) {
      for (const entry of state[key]) {
        if (entry.chatId) ids.add(entry.chatId);
      }
    }
    onlineIds = ids;
    emit();
  };

  ch.on("presence", { event: "sync" }, refresh)
    .on("presence", { event: "join" }, refresh)
    .on("presence", { event: "leave" }, refresh)
    .subscribe((status) => {
      // Only react for the live channel (an old one fires CLOSED on replace).
      if (channel !== ch) return;
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (ownerRetry) clearTimeout(ownerRetry);
        ownerRetry = setTimeout(connectOwnerChannel, 3000);
      }
    });
}

/** Reconnect the watch channel when the tab wakes up or the network returns. */
function wireOwnerReconnect() {
  if (ownerWired || typeof window === "undefined") return;
  ownerWired = true;
  const kick = () => {
    if (document.visibilityState !== "visible") return;
    if (!channelOwner || listeners.size === 0) return;
    if (!channel || channel.state !== "joined") connectOwnerChannel();
  };
  window.addEventListener("online", kick);
  window.addEventListener("focus", kick);
  document.addEventListener("visibilitychange", kick);
}

function ensureChannel(ownerId: string) {
  wireOwnerReconnect();
  if (channel && channelOwner === ownerId) return;
  channelOwner = ownerId;
  connectOwnerChannel();
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

/** Guest side: announce presence on the owner's channel while the app is open. */
export function trackGuestPresence(ownerId: string, chatId: string): () => void {
  const supabase = supabaseBrowser();
  let stopped = false;
  let track: RealtimeChannel | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (stopped) return;
    if (track) supabase.removeChannel(track);
    const ch = supabase.channel(topicFor(ownerId), {
      config: { presence: { key: chatId } },
    });
    track = ch;
    ch.subscribe(async (status) => {
      if (stopped || track !== ch) return;
      if (status === "SUBSCRIBED") {
        // (Re)announce — also runs after an automatic socket rejoin.
        await ch.track({ chatId, online_at: new Date().toISOString() });
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        if (retry) clearTimeout(retry);
        retry = setTimeout(connect, 3000);
      }
    });
  };
  connect();

  // Waking the tab / regaining network: make sure we're still announced.
  const kick = () => {
    if (stopped || document.visibilityState !== "visible") return;
    if (!track || track.state !== "joined") connect();
  };
  window.addEventListener("online", kick);
  window.addEventListener("focus", kick);
  document.addEventListener("visibilitychange", kick);

  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    window.removeEventListener("online", kick);
    window.removeEventListener("focus", kick);
    document.removeEventListener("visibilitychange", kick);
    if (track) supabase.removeChannel(track);
  };
}
