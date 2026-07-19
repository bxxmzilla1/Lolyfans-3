import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { ipFromHeaders } from "@/lib/invites";
import { subPlanFromMetadata, type SubPlan } from "@/lib/subscriptionPlan";

export type GuestChat = {
  id: string;
  owner_id: string;
  guest_name: string;
  guest_email: string | null;
  guest_avatar_path: string | null;
  guest_last_read_at: string | null;
  last_message_at: string;
};

const CHAT_COLUMNS =
  "id, owner_id, guest_name, guest_email, guest_avatar_path, guest_last_read_at, last_message_at";

/**
 * Every chat that belongs to this guest — matched by their session cookie,
 * their remembered IP (covers cleared history / other browsers), and the
 * email their account is registered with (covers logging in on a computer).
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
    .select(CHAT_COLUMNS)
    .or(filters.join(","))
    .order("last_message_at", { ascending: false });
  const chats = (data as GuestChat[]) ?? [];

  // Same email registered with other creators? Those chats are theirs too.
  const emails = [...new Set(chats.map((c) => c.guest_email).filter(Boolean))] as string[];
  if (emails.length) {
    const { data: byEmail } = await db
      .from("chats")
      .select(CHAT_COLUMNS)
      .in("guest_email", emails);
    for (const chat of (byEmail as GuestChat[]) ?? []) {
      if (!chats.some((c) => c.id === chat.id)) chats.push(chat);
    }
    chats.sort(
      (a, b) => +new Date(b.last_message_at) - +new Date(a.last_message_at)
    );
  }
  return chats;
}

export type OwnerProfile = {
  name: string;
  avatarPath: string | null;
  bannerPath: string | null;
  verified: boolean;
  /** Owner-set base follower count (Social proof tab). */
  followerBase: number;
  bio: string | null;
  /** Show a location line (the visitor's own city) under the bio. */
  showLocation: boolean;
  /** Profile-subscription plan (price 0 = free). */
  plan: SubPlan;
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
        banner_path?: string;
        invite_verified?: boolean;
        social_followers?: number;
        profile_bio?: string;
        profile_show_location?: boolean;
      };
      return [
        id,
        {
          name: meta.display_name || "Lolyfans",
          avatarPath: meta.avatar_path || null,
          bannerPath: meta.banner_path || null,
          verified: !!meta.invite_verified,
          followerBase: Number(meta.social_followers) || 0,
          bio: meta.profile_bio?.trim() || null,
          showLocation: !!meta.profile_show_location,
          plan: subPlanFromMetadata(meta as Record<string, unknown>),
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
