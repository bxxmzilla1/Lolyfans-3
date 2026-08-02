import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats } from "@/lib/guest";
import { telegramLinkFromMetadata } from "@/lib/subscriptionPlan";

/**
 * The creator's private Telegram channel invite link — available to any fan
 * who has signed up with this creator. Channel access is free (no subscription).
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
  return NextResponse.json({ link: link || null });
}
