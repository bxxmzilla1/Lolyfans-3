import { supabaseAdmin } from "@/lib/supabase/admin";
import { subPlanFromMetadata, type SubPlan } from "@/lib/subscriptionPlan";

export const ACTIVE_SUB_STATUSES = ["trialing", "active", "past_due", "canceling"];

/** Load a creator's subscription plan from auth metadata. */
export async function ownerSubPlan(ownerId: string): Promise<SubPlan> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(ownerId);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  return subPlanFromMetadata(meta);
}

/** True when the creator charges for profile access. */
export async function ownerRequiresPaidSub(ownerId: string): Promise<boolean> {
  const plan = await ownerSubPlan(ownerId);
  return plan.priceCents > 0;
}

/** Fan has an active/trialing/etc. paid subscription for this creator. */
export async function chatHasPaidAccess(
  chatId: string,
  ownerId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("subscriptions")
    .select("status")
    .eq("chat_id", chatId)
    .eq("owner_id", ownerId)
    .in("status", ACTIVE_SUB_STATUSES)
    .maybeSingle();
  return !!data;
}

/** Invite code to send unpaid fans back to the card step. */
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
 * Where a returning guest should land. Paid creators with no subscription
 * stay on the signup payment step — never /chat or the fan shell.
 */
export async function guestAccessDestination(
  chatId: string,
  ownerId: string
): Promise<{ allowed: boolean; href: string }> {
  if (!(await ownerRequiresPaidSub(ownerId))) {
    return { allowed: true, href: "/chat" };
  }
  if (await chatHasPaidAccess(chatId, ownerId)) {
    return { allowed: true, href: "/chat" };
  }
  const code = await inviteCodeForChat(chatId);
  return {
    allowed: false,
    href: code ? `/i/${code}/signup?pay=1` : "/",
  };
}

/**
 * Resolve access for a chat id (loads owner_id). Used by /chat and fan layout.
 */
export async function guestChatAccessDestination(
  chatId: string
): Promise<{ allowed: boolean; href: string; ownerId: string | null }> {
  const { data: chat } = await supabaseAdmin()
    .from("chats")
    .select("owner_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return { allowed: false, href: "/?resume=0", ownerId: null };
  const dest = await guestAccessDestination(chatId, chat.owner_id);
  return { ...dest, ownerId: chat.owner_id as string };
}
