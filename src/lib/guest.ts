import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { ipFromHeaders } from "@/lib/invites";

export type GuestChat = {
  id: string;
  owner_id: string;
  guest_name: string;
  guest_avatar_path: string | null;
  guest_last_read_at: string | null;
  last_message_at: string;
};

/**
 * Every chat that belongs to this guest — matched by their session cookie
 * and/or their remembered IP (covers cleared history / other browsers).
 */
export async function guestChats(requestHeaders: Headers): Promise<GuestChat[]> {
  const db = supabaseAdmin();
  const cookieChatId = await getGuestChatId();
  const ip = ipFromHeaders(requestHeaders);

  const filters: string[] = [];
  if (cookieChatId) filters.push(`id.eq.${cookieChatId}`);
  if (ip) filters.push(`guest_ip.eq.${ip}`);
  if (filters.length === 0) return [];

  const { data } = await db
    .from("chats")
    .select("id, owner_id, guest_name, guest_avatar_path, guest_last_read_at, last_message_at")
    .or(filters.join(","))
    .order("last_message_at", { ascending: false });
  return (data as GuestChat[]) ?? [];
}

export type OwnerProfile = {
  name: string;
  avatarPath: string | null;
  verified: boolean;
  /** Owner-set base follower count (Social proof tab). */
  followerBase: number;
};

/** Display profiles (name, picture, checkmark) for a set of creators. */
export async function ownerProfiles(
  ownerIds: string[]
): Promise<Map<string, OwnerProfile>> {
  const db = supabaseAdmin();
  const unique = [...new Set(ownerIds)];
  const entries = await Promise.all(
    unique.map(async (id) => {
      const { data } = await db.auth.admin.getUserById(id);
      if (!data?.user) return null;
      const meta = (data.user.user_metadata ?? {}) as {
        display_name?: string;
        avatar_path?: string;
        invite_verified?: boolean;
        social_followers?: number;
      };
      return [
        id,
        {
          name: meta.display_name || "Lolyfans",
          avatarPath: meta.avatar_path || null,
          verified: !!meta.invite_verified,
          followerBase: Number(meta.social_followers) || 0,
        },
      ] as const;
    })
  );
  return new Map(entries.filter((e) => e !== null));
}

/** Unread (owner-sent, visible) message counts per chat for a guest. */
export async function guestUnreadCounts(
  chats: GuestChat[]
): Promise<Map<string, number>> {
  const db = supabaseAdmin();
  const counts = new Map<string, number>();
  await Promise.all(
    chats.map(async (chat) => {
      const since = chat.guest_last_read_at || "1970-01-01T00:00:00Z";
      const { count } = await db
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("chat_id", chat.id)
        .eq("sender", "owner")
        .eq("hidden", false)
        .gt("created_at", since);
      counts.set(chat.id, count ?? 0);
    })
  );
  return counts;
}
