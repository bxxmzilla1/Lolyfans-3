import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats } from "@/lib/guest";
import { chatHasPaidAccess } from "@/lib/subscriptionAccess";
import {
  subPlanFromMetadata,
  telegramLinkFromMetadata,
} from "@/lib/subscriptionPlan";

/**
 * The creator's private Telegram channel invite link — only revealed to fans
 * with an active (or trialing) subscription. This is the ONLY place the link
 * leaves the server, so it can never be scraped off the profile page.
 */
export async function GET(req: NextRequest) {
  const ownerId = req.nextUrl.searchParams.get("ownerId");
  if (!ownerId) {
    return NextResponse.json({ error: "ownerId required" }, { status: 400 });
  }

  const chats = await guestChats(req.headers);
  const chat = chats.find((c) => c.owner_id === ownerId);
  if (!chat) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: ownerUser } = await supabaseAdmin().auth.admin.getUserById(ownerId);
  const meta = (ownerUser?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const link = telegramLinkFromMetadata(meta);
  if (!link) return NextResponse.json({ link: null });

  // Paid profiles require an active subscription; free profiles share the
  // link with anyone who joined.
  const plan = subPlanFromMetadata(meta);
  if (plan.priceCents > 0 && !(await chatHasPaidAccess(chat.id, ownerId))) {
    return NextResponse.json(
      { error: "Subscribe to get the channel link" },
      { status: 402 }
    );
  }

  return NextResponse.json({ link });
}
