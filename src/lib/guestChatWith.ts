import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";
import { inheritVerifiedCard } from "@/lib/subscriptionAccess";
import { notifyCrossCreatorSubscribe } from "@/lib/adminTelegram";
import type { GuestChat } from "@/lib/guest";

/**
 * Make sure this fan has a chat with `ownerId`, creating one from their
 * existing account when they don't (following a creator, tapping Message on
 * a post). The new chat inherits the fan's identity — and their verified
 * card, so they appear in the creator's inbox and one-tap purchases work.
 *
 * Returns null when the fan has no account at all.
 */
export async function ensureGuestChatWith(
  ownerId: string,
  chats: GuestChat[]
): Promise<{ chat: GuestChat; created: boolean } | null> {
  const existing = chats.find((c) => c.owner_id === ownerId);
  if (existing) return { chat: existing, created: false };
  if (!chats.length) return null;

  const db = supabaseAdmin();
  // Copy identity from their most recent chat (guestChats sorts newest first).
  const { data: source } = await db
    .from("chats")
    .select(
      "guest_name, guest_email, guest_password, guest_phone, guest_ip, guest_country, guest_city, guest_avatar_path"
    )
    .eq("id", chats[0].id)
    .maybeSingle();
  if (!source) return null;

  // Same email may already have a chat here that guestChats missed (e.g. a
  // different device) — reuse it instead of creating a duplicate.
  if (source.guest_email) {
    const { data: byEmail } = await db
      .from("chats")
      .select("id, owner_id, guest_name, guest_email, guest_avatar_path, guest_last_read_at, last_message_at")
      .eq("owner_id", ownerId)
      .eq("guest_email", source.guest_email)
      .maybeSingle();
    if (byEmail) return { chat: byEmail as GuestChat, created: false };
  }

  const row: Record<string, unknown> = {
    owner_id: ownerId,
    guest_name: source.guest_name,
    guest_email: source.guest_email,
    guest_password: source.guest_password,
    guest_phone: source.guest_phone,
    guest_ip: source.guest_ip,
    guest_country: source.guest_country,
    guest_city: source.guest_city,
    guest_avatar_path: source.guest_avatar_path,
    pending: false,
  };
  let { data: chat, error } = await db
    .from("chats")
    .insert(row)
    .select("id, owner_id, guest_name, guest_email, guest_avatar_path, guest_last_read_at, last_message_at")
    .single();
  if (error && /pending/i.test(error.message)) {
    const { pending: _ignored, ...withoutPending } = row;
    void _ignored;
    ({ data: chat, error } = await db
      .from("chats")
      .insert(withoutPending)
      .select("id, owner_id, guest_name, guest_email, guest_avatar_path, guest_last_read_at, last_message_at")
      .single());
  }
  if (error || !chat) return null;

  // Verified card with another creator → copied here (that path pings the
  // admin bot itself). No card yet → still report the cross-creator subscribe.
  const cardCopied = await inheritVerifiedCard(chat.id as string, source.guest_email);
  if (!cardCopied) {
    const newChatId = chat.id as string;
    after(() =>
      notifyCrossCreatorSubscribe(newChatId, ownerId, chats[0].owner_id, false, "Message button")
    );
  }
  await broadcast(`inbox:${ownerId}`, "new-chat", { chatId: chat.id });

  return { chat: chat as GuestChat, created: true };
}
