import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  subFirstPeriodCents,
  subPlanFromMetadata,
  type SubInterval,
  type SubPlan,
} from "@/lib/subscriptionPlan";
import { revealPendingChat } from "@/lib/payments";

export const ACTIVE_SUB_STATUSES = ["trialing", "active", "past_due", "canceling"];

export type SubRow = {
  status: string;
  price_cents: number;
  billing_interval: string;
  current_period_end: string | null;
  trial_end?: string | null;
};

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
 * Chats of a paid creator that ever subscribed (started the free trial or
 * paid in USDC). Paid profiles list only these in the inbox; free profiles
 * show everyone who signed up.
 */
export async function subscriberChatIds(ownerId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin()
    .from("subscriptions")
    .select("chat_id")
    .eq("owner_id", ownerId);
  return new Set((data ?? []).map((r) => String(r.chat_id)));
}

/** Trial or paid period still running (lifetime never ends). */
export function subscriptionLive(row: SubRow | null | undefined): boolean {
  if (!row || !ACTIVE_SUB_STATUSES.includes(row.status)) return false;
  if (row.billing_interval === "lifetime") return true;
  return !!row.current_period_end && Date.parse(row.current_period_end) > Date.now();
}

export async function chatSubscription(chatId: string, ownerId: string): Promise<SubRow | null> {
  const { data } = await supabaseAdmin()
    .from("subscriptions")
    .select("status, price_cents, billing_interval, current_period_end, trial_end")
    .eq("chat_id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  return (data as SubRow | null) ?? null;
}

/**
 * Free-trial plans: the first visit starts the trial (once per chat — the
 * row stays after it ends, so a fan can't trial twice). Returns true when a
 * trial was started.
 */
async function startTrial(chatId: string, ownerId: string, plan: SubPlan): Promise<boolean> {
  if (plan.priceCents <= 0 || plan.trialDays <= 0) return false;
  const end = new Date(Date.now() + plan.trialDays * 86_400_000).toISOString();
  const { data } = await supabaseAdmin()
    .from("subscriptions")
    .upsert(
      {
        chat_id: chatId,
        owner_id: ownerId,
        stripe_subscription_id: null,
        status: "trialing",
        price_cents: plan.priceCents,
        billing_interval: plan.interval,
        current_period_end: end,
        trial_end: end,
      },
      { onConflict: "chat_id,owner_id", ignoreDuplicates: true }
    )
    .select("chat_id");
  if (!data?.length) return false;
  await supabaseAdmin()
    .from("follows")
    .upsert(
      { chat_id: chatId, owner_id: ownerId },
      { onConflict: "chat_id,owner_id", ignoreDuplicates: true }
    );
  return true;
}

/**
 * Does this chat get into a paid creator's chat? Yes while a trial or a
 * USDC-paid period is running. Subscriptions never renew on their own — the
 * fan pays each period from Phantom.
 */
export async function chatHasPaidAccess(
  chatId: string,
  ownerId: string,
  plan?: SubPlan
): Promise<boolean> {
  const row = await chatSubscription(chatId, ownerId);
  if (row) return subscriptionLive(row);
  return startTrial(chatId, ownerId, plan ?? (await ownerSubPlan(ownerId)));
}

/** What the next USDC payment costs: first period discounted, lifetime once. */
export function subscriptionChargeCents(plan: SubPlan, row: SubRow | null): number {
  if (plan.interval === "lifetime") return plan.priceCents;
  const neverPaid = !row || row.status === "trialing";
  return neverPaid ? subFirstPeriodCents(plan) : plan.priceCents;
}

function addInterval(fromMs: number, interval: SubInterval): Date {
  const d = new Date(fromMs);
  if (interval === "day") d.setUTCDate(d.getUTCDate() + 1);
  else if (interval === "week") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/**
 * A USDC subscription payment landed: extend access by one period (from the
 * end of the running trial/period, so paying early never loses days), or
 * grant lifetime access. Returns the new end (null = lifetime).
 */
export async function recordSubscriptionPayment(opts: {
  chatId: string;
  ownerId: string;
  plan: SubPlan;
  amountCents: number;
}): Promise<string | null> {
  const db = supabaseAdmin();
  const row = await chatSubscription(opts.chatId, opts.ownerId);
  const now = Date.now();
  const lifetime = opts.plan.interval === "lifetime";

  let periodEnd: string | null = null;
  if (!lifetime) {
    const running =
      subscriptionLive(row) && row?.current_period_end
        ? Math.max(now, Date.parse(row.current_period_end))
        : now;
    periodEnd = addInterval(running, opts.plan.interval).toISOString();
  }
  // Paying ends the trial for stats purposes (invite_stats 'paid').
  const trialEnd =
    row?.trial_end && Date.parse(row.trial_end) > now ? new Date(now).toISOString() : row?.trial_end ?? null;

  await db.from("subscriptions").upsert(
    {
      chat_id: opts.chatId,
      owner_id: opts.ownerId,
      stripe_subscription_id: null,
      status: "active",
      price_cents: opts.amountCents,
      billing_interval: opts.plan.interval,
      current_period_end: periodEnd,
      trial_end: trialEnd,
    },
    { onConflict: "chat_id,owner_id" }
  );
  await db
    .from("follows")
    .upsert(
      { chat_id: opts.chatId, owner_id: opts.ownerId },
      { onConflict: "chat_id,owner_id", ignoreDuplicates: true }
    );
  await revealPendingChat(opts.chatId, opts.ownerId);
  return periodEnd;
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

/** The profile page with the payment sheet auto-opened. */
export function subscribeHref(ownerId: string): string {
  return `/p/${ownerId}?subscribe=1`;
}

/**
 * Where a signed-up fan should land: the app when allowed, otherwise the
 * creator's profile with the USDC payment step open (paid profile, no
 * running trial or paid period).
 */
export async function guestAccessDestination(
  chatId: string,
  ownerId: string
): Promise<{ allowed: boolean; href: string }> {
  const plan = await ownerSubPlan(ownerId);
  if (plan.priceCents <= 0) return { allowed: true, href: "/home" };
  if (await chatHasPaidAccess(chatId, ownerId, plan)) return { allowed: true, href: "/home" };
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
