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
/** Fans announced on the realtime channel. */
let presenceIds = new Set<string>();
/** Fans whose heartbeat the server saw in the last few seconds (1s poll). */
let heartbeatIds = new Set<string>();
/** Merged view handed to listeners. */
let onlineIds = new Set<string>();
const listeners = new Set<(ids: Set<string>) => void>();
let ownerRetry: ReturnType<typeof setTimeout> | null = null;
let ownerWired = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInflight = false;

const POLL_MS = 1000;

function topicFor(ownerId: string) {
  return `presence:owner:${ownerId}:guests`;
}

function sameSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Recompute the merged set; notify only when something actually changed. */
function recompute() {
  const merged = new Set<string>([...presenceIds, ...heartbeatIds]);
  if (sameSet(merged, onlineIds)) return;
  onlineIds = merged;
  const snapshot = new Set(onlineIds);
  listeners.forEach((l) => l(snapshot));
}

/**
 * Background check every second: asks the server which fans heart-beated
 * recently. Runs whether or not the tab is visible (the desktop app keeps
 * several inboxes mounted off-screen), and touches React only on change.
 */
async function pollOnline() {
  if (pollInflight || listeners.size === 0) return;
  pollInflight = true;
  try {
    const res = await fetch("/api/chats/online", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { ids?: string[] };
      heartbeatIds = new Set(Array.isArray(data.ids) ? data.ids : []);
      recompute();
    }
  } catch {
    // Offline / hiccup: keep the last known state.
  } finally {
    pollInflight = false;
  }
}

function ensurePolling() {
  if (pollTimer || typeof window === "undefined") return;
  pollTimer = setInterval(pollOnline, POLL_MS);
  void pollOnline();
}

function stopPollingIfIdle() {
  if (listeners.size > 0 || !pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
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
    presenceIds = ids;
    recompute();
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
  ensurePolling();
  cb(new Set(onlineIds));
  return () => {
    listeners.delete(cb);
    stopPollingIfIdle();
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
