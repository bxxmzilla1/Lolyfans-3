import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats, ownerProfiles } from "@/lib/guest";
import {
  ACTIVE_SUB_STATUSES,
  subscriptionChargeCents,
  subscriptionLive,
  type SubRow,
} from "@/lib/subscriptionAccess";
import { mediaUrl } from "@/lib/utils";

/**
 * Every creator this fan subscribes to (trial, paid period or expired),
 * across all of their chats. Powers the Subscriptions list in the fan
 * Profile tab, where each row's sheet pays the next period in USDC.
 */
export async function GET(req: NextRequest) {
  const chats = await guestChats(req.headers);
  if (chats.length === 0) return NextResponse.json({ subscriptions: [] });

  const { data: rows } = await supabaseAdmin()
    .from("subscriptions")
    .select(
      "chat_id, owner_id, status, price_cents, billing_interval, current_period_end, trial_end"
    )
    .in(
      "chat_id",
      chats.map((c) => c.id)
    )
    .in("status", ACTIVE_SUB_STATUSES);

  const subs = rows ?? [];
  if (subs.length === 0) return NextResponse.json({ subscriptions: [] });

  const profiles = await ownerProfiles(subs.map((s) => s.owner_id as string));

  return NextResponse.json({
    subscriptions: subs.map((s) => {
      const profile = profiles.get(s.owner_id as string);
      const row = s as unknown as SubRow;
      const plan = profile?.plan;
      return {
        ownerId: s.owner_id as string,
        name: profile?.name ?? "Creator",
        avatarUrl: profile?.avatarPath ? mediaUrl(profile.avatarPath) : null,
        verified: !!profile?.verified,
        status: s.status as string,
        live: subscriptionLive(row),
        priceCents: Number(s.price_cents) || 0,
        interval: (s.billing_interval as string) || "month",
        currentPeriodEnd: (s.current_period_end as string | null) ?? null,
        // What the next USDC payment costs (creator's current plan).
        nextChargeCents: plan && plan.priceCents > 0 ? subscriptionChargeCents(plan, row) : 0,
        planInterval: plan?.interval ?? ((s.billing_interval as string) || "month"),
      };
    }),
  });
}
