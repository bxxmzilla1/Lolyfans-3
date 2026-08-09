import type { FeedPost } from "@/components/PostFeed";
import type { SubPlan } from "@/lib/subscriptionPlan";

// The chat rows the guest bootstrap returns (the old guest chat list UI is
// gone; the shell still uses these for unread badges and presence).
export type GuestChatRow = {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string | null;
  verified: boolean;
  preview: string;
  lastMessageAt: string;
  unread: number;
};

export type GuestBootstrap = {
  profile: { name: string; avatarPath: string | null };
  chats: GuestChatRow[];
  unread: number;
  home: {
    suggestions: Array<{
      ownerId: string;
      name: string;
      avatarPath: string | null;
      verified: boolean;
      plan?: SubPlan | null;
    }>;
    posts: FeedPost[];
    canInteract: boolean;
  };
};

let cached: GuestBootstrap | null = null;

export function getGuestBootstrapCache() {
  return cached;
}

export function setGuestBootstrapCache(data: GuestBootstrap | null) {
  cached = data;
}

/**
 * Zero one chat's unread in the in-memory shell cache (and notify listeners).
 * Called once the /chat page has loaded so badges stay until then, but are
 * already gone when the fan returns to the list.
 */
export function markGuestChatReadLocally(chatId: string) {
  if (cached) {
    const chat = cached.chats.find((c) => c.id === chatId);
    if (chat && chat.unread > 0) {
      cached = {
        ...cached,
        unread: Math.max(0, cached.unread - chat.unread),
        chats: cached.chats.map((c) =>
          c.id === chatId ? { ...c, unread: 0 } : c
        ),
      };
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("guest-chat-read", { detail: { chatId } })
    );
  }
}
