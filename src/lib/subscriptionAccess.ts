import { supabaseAdmin } from "@/lib/supabase/admin";
import { getMainTelegramLink } from "@/lib/mainChannel";
import { subPlanFromMetadata, type SubPlan } from "@/lib/subscriptionPlan";

export const ACTIVE_SUB_STATUSES = ["trialing", "active", "past_due", "canceling"];

/** Load a creator's (legacy) plan metadata — price is ignored; channel is free. */
export async function ownerSubPlan(ownerId: string): Promise<SubPlan> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(ownerId);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  return subPlanFromMetadata(meta);
}

/** Channel access is free — kept for callers that still check the old gate. */
export async function ownerRequiresPaidSub(_ownerId: string): Promise<boolean> {
  return false;
}

/** Always true now — channel subscriptions are removed. */
export async function chatHasPaidAccess(
  _chatId: string,
  _ownerId: string
): Promise<boolean> {
  return true;
}

export async function inviteCodeForChat(chatId: string): Promise<string | null> {
  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("invite_id, owner_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return null;

  if (chat.invite_id) {
    const { data: invite } = await db
      .from("invites")
      .select("code")
      .eq("id", chat.invite_id)
      .maybeSingle();
    if (invite?.code) return invite.code as string;
  }

  const { data: fallback } = await db
    .from("invites")
    .select("code")
    .eq("owner_id", chat.owner_id)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (fallback?.code as string) || null;
}

/**
 * Where a returning guest should land — the site-wide main Telegram channel.
 * Invite links never use this; they redirect via their own redirect_url.
 */
export async function guestAccessDestination(
  _chatId: string,
  _ownerId: string
): Promise<{ allowed: boolean; href: string }> {
  const link = await getMainTelegramLink();
  return { allowed: true, href: link || "/" };
}

/**
 * Resolve access for a chat id (loads owner_id). Used by leftover fan routes.
 */
export async function guestChatAccessDestination(
  chatId: string
): Promise<{ allowed: boolean; href: string; ownerId: string | null }> {
  const { data: chat } = await supabaseAdmin()
    .from("chats")
    .select("owner_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return { allowed: false, href: "/api/guest/gone", ownerId: null };
  const link = await getMainTelegramLink();
  return {
    allowed: true,
    href: link || "/",
    ownerId: chat.owner_id as string,
  };
}
