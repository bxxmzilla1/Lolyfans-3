import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { mediaItemsFromMessage } from "@/lib/utils";

/**
 * Live fan state for the creator's open chat. Polled every second while the
 * tab is visible: card-on-file, plus accept/decline/unlock status for each
 * creator photo/video so Declined / paid bubbles update without a refresh.
 */
export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("stripe_payment_method_id")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  // Recent owner media only — enough for the open thread, cheap to poll.
  const { data: rows } = await db
    .from("messages")
    .select("id, fan_decision, media_path, media_type, media_items")
    .eq("chat_id", chatId)
    .eq("sender", "owner")
    .order("created_at", { ascending: false })
    .limit(80);

  const mediaRows = (rows ?? []).filter((m) =>
    mediaItemsFromMessage(m).some((i) => i.type === "image" || i.type === "video")
  );
  const ids = mediaRows.map((m) => m.id as string);
  const unlocked = new Set<string>();
  if (ids.length) {
    const { data: unlocks } = await db
      .from("message_unlocks")
      .select("message_id")
      .eq("chat_id", chatId)
      .in("message_id", ids);
    for (const u of unlocks ?? []) unlocked.add(u.message_id as string);
  }

  const media = mediaRows.map((m) => ({
    id: m.id as string,
    fan_decision: (m.fan_decision as "accepted" | "rejected" | null) ?? null,
    unlocked: unlocked.has(m.id as string),
  }));

  return NextResponse.json({
    hasCard: !!chat.stripe_payment_method_id,
    media,
  });
}
