import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { broadcast } from "@/lib/realtime";
import { paidSubFromMetadata } from "@/lib/paidSub";

/**
 * PaidSub creator controls for one chat:
 *   GET            — current state for the composer sheet
 *   POST "offer"   — push the blocking popup into the fan's chat
 *   POST "cancel"  — take the popup back down
 */
export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("paidsub_offer_at, paidsub_paid_at")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const { data: ownerUser } = await db.auth.admin.getUserById(ownerId);
  const cfg = paidSubFromMetadata(ownerUser?.user?.user_metadata ?? {});

  return NextResponse.json({
    enabled: cfg.enabled,
    tokens: cfg.tokens,
    priceCents: cfg.priceCents,
    originalCents: cfg.originalCents,
    offered: !!chat.paidsub_offer_at,
    paid: !!chat.paidsub_paid_at,
  });
}

export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId, action } = await req.json();
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("paidsub_offer_at, paidsub_paid_at")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  if (chat.paidsub_paid_at) {
    return NextResponse.json({ ok: true, paid: true, offered: false });
  }

  const { data: ownerUser } = await db.auth.admin.getUserById(ownerId);
  const cfg = paidSubFromMetadata(ownerUser?.user?.user_metadata ?? {});

  if (action === "offer") {
    if (!cfg.enabled) {
      return NextResponse.json(
        { error: "Turn on PaidSub in Settings first" },
        { status: 400 }
      );
    }
    await db
      .from("chats")
      .update({ paidsub_offer_at: new Date().toISOString() })
      .eq("id", chatId);
    await broadcast(`chat:${chatId}`, "paidsub", {
      offered: true,
      paid: false,
      tokens: cfg.tokens,
      priceCents: cfg.priceCents,
      originalCents: cfg.originalCents,
    });
    return NextResponse.json({
      ok: true,
      offered: true,
      paid: false,
      tokens: cfg.tokens,
      priceCents: cfg.priceCents,
      originalCents: cfg.originalCents,
    });
  }

  if (action === "cancel") {
    await db
      .from("chats")
      .update({ paidsub_offer_at: null })
      .eq("id", chatId);
    await broadcast(`chat:${chatId}`, "paidsub", { offered: false, paid: false });
    return NextResponse.json({ ok: true, offered: false, paid: false });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
