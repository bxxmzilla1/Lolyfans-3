import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { subPlanFromMetadata, type SubPlan } from "@/lib/subscriptionPlan";
import { notifyCrossCreatorSubscribe } from "@/lib/adminTelegram";

export const ACTIVE_SUB_STATUSES = ["trialing", "active", "past_due", "canceling"];

/** Load a creator's subscription plan from their auth metadata. */
export async function ownerSubPlan(ownerId: string): Promise<SubPlan> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(ownerId);
  const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  return subPlanFromMetadata(meta);
}

/** Paid profile (Settings → Subscription set to PAID with a price). */
export async function ownerRequiresPaidSub(ownerId: string): Promise<boolean> {
  return (await ownerSubPlan(ownerId)).priceCents > 0;
}

/**
 * Does this chat get into a paid creator's chat? Yes when the fan has a
 * verified card saved (the whole point of the paywall is card-on-file for
 * one-tap purchases) or an active/trialing subscription with this creator.
 *
 * A card verified with ANY creator counts: the same email's other chats are
 * checked and the card is copied onto this chat so one-tap works here too.
 * Canceling a subscription never removes access — the card stays.
 */
export async function chatHasPaidAccess(
  chatId: string,
  ownerId: string
): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, guest_email, stripe_payment_method_id")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat) return false;
  if (chat.stripe_payment_method_id) return true;

  const { data: sub } = await db
    .from("subscriptions")
    .select("status")
    .eq("chat_id", chatId)
    .eq("owner_id", ownerId)
    .in("status", ACTIVE_SUB_STATUSES)
    .maybeSingle();
  if (sub) return true;

  return inheritVerifiedCard(chatId, chat.guest_email);
}

/**
 * Copy a verified card from another chat with the same email onto this chat
 * (one-tap works with every creator once a card is verified anywhere).
 * Returns true if a card was copied. Notifies the admin bot: a verified fan
 * just subscribed to another creator.
 */
export async function inheritVerifiedCard(
  chatId: string,
  guestEmail: string | null | undefined
): Promise<boolean> {
  if (!guestEmail) return false;
  const db = supabaseAdmin();
  const { data: other } = await db
    .from("chats")
    .select("owner_id, stripe_customer_id, stripe_payment_method_id")
    .eq("guest_email", guestEmail)
    .neq("id", chatId)
    .not("stripe_payment_method_id", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!other?.stripe_payment_method_id) return false;

  // Only the update that flips null → card matches, so a race can't copy
  // (or notify) twice.
  const { data: copied } = await db
    .from("chats")
    .update({
      stripe_customer_id: other.stripe_customer_id,
      stripe_payment_method_id: other.stripe_payment_method_id,
    })
    .eq("id", chatId)
    .is("stripe_payment_method_id", null)
    .select("owner_id");
  if (!copied?.length) return true; // someone else already copied it

  const ownerId = copied[0].owner_id as string;
  after(() => notifyCrossCreatorSubscribe(chatId, ownerId, other.owner_id as string));
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

/** The profile page with the card sheet auto-opened. */
export function subscribeHref(ownerId: string): string {
  return `/p/${ownerId}?subscribe=1`;
}

/**
 * Where a signed-up guest should land: the app when allowed, otherwise the
 * creator's profile with the card step open (paid profile, no card yet).
 */
export async function guestAccessDestination(
  chatId: string,
  ownerId: string
): Promise<{ allowed: boolean; href: string }> {
  if (!(await ownerRequiresPaidSub(ownerId))) return { allowed: true, href: "/home" };
  if (await chatHasPaidAccess(chatId, ownerId)) return { allowed: true, href: "/home" };
  return { allowed: false, href: subscribeHref(ownerId) };
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
  if (!chat) return { allowed: false, href: "/api/guest/gone", ownerId: null };
  const ownerId = chat.owner_id as string;
  const access = await guestAccessDestination(chatId, ownerId);
  return { ...access, ownerId };
}
