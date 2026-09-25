import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { broadcast } from "@/lib/realtime";
import { notifyCrossCreatorSubscribe } from "@/lib/adminTelegram";
import { sendWelcomeMessage } from "@/lib/chatWelcome";
import { GUEST_CHAT_COLUMNS, type GuestChat } from "@/lib/guest";

/**
 * Make sure this fan has a chat with `ownerId`, creating one from their
 * existing account when they don't (following a creator, tapping Message on
 * a post). The new chat inherits the fan's identity (wallet, name, picture).
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
      "guest_name, guest_email, guest_wallet, guest_password, guest_phone, guest_ip, guest_country, guest_city, guest_avatar_path"
    )
    .eq("id", chats[0].id)
    .maybeSingle();
  if (!source) return null;

  // Same wallet / email may already have a chat here that guestChats missed
  // (e.g. a different device) — reuse it instead of creating a duplicate.
  const filters: string[] = [];
  if (source.guest_wallet) filters.push(`guest_wallet.eq.${source.guest_wallet}`);
  if (source.guest_email) filters.push(`guest_email.eq.${source.guest_email}`);
  if (filters.length) {
    const { data: dup } = await db
      .from("chats")
      .select(GUEST_CHAT_COLUMNS)
      .eq("owner_id", ownerId)
      .or(filters.join(","))
      .limit(1)
      .maybeSingle();
    if (dup) return { chat: dup as GuestChat, created: false };
  }

  const row: Record<string, unknown> = {
    owner_id: ownerId,
    guest_name: source.guest_name,
    guest_email: source.guest_email,
    guest_wallet: source.guest_wallet,
    guest_password: source.guest_password,
    guest_phone: source.guest_phone,
    guest_ip: source.guest_ip,
    guest_country: source.guest_country,
    guest_city: source.guest_city,
    guest_avatar_path: source.guest_avatar_path,
  };
  const { data: chat, error } = await db
    .from("chats")
    .insert(row)
    .select(GUEST_CHAT_COLUMNS)
    .single();
  if (error || !chat) return null;

  // The creator's welcome message (Settings → Chat) opens the new chat.
  await sendWelcomeMessage(chat.id as string, ownerId, {
    city: (source.guest_city as string | null) ?? null,
    country: (source.guest_country as string | null) ?? null,
  });

  const newChatId = chat.id as string;
  after(() => notifyCrossCreatorSubscribe(newChatId, ownerId, chats[0].owner_id, "Message button"));
  await broadcast(`inbox:${ownerId}`, "new-chat", { chatId: chat.id });

  return { chat: chat as GuestChat, created: true };
}
