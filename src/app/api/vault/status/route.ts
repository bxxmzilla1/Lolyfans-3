import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

/**
 * Per-chat send status for vault media, keyed by storage path (vault items
 * and messages share the same media_path — no re-upload happens on send):
 *
 *   "free"     → sent in this chat without a price      (orange outline)
 *   "locked"   → sent price-locked, fan never unlocked  (red outline)
 *   "unlocked" → sent price-locked and the fan paid     (green outline)
 *
 * Paths never sent in this chat are simply absent from the map.
 */
export async function GET(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const [{ data: messages }, { data: unlocks }] = await Promise.all([
    db
      .from("messages")
      .select("id, media_path, media_items, locked, price_cents")
      .eq("chat_id", chatId)
      .eq("sender", "owner")
      .not("media_path", "is", null),
    db.from("message_unlocks").select("message_id").eq("chat_id", chatId),
  ]);

  const unlockedIds = new Set((unlocks ?? []).map((u) => u.message_id as string));

  // A path may have been sent more than once — keep the strongest signal:
  // unlocked (paid) beats locked (pending) beats free.
  const RANK = { free: 1, locked: 2, unlocked: 3 } as const;
  type Status = keyof typeof RANK;
  const status: Record<string, Status> = {};

  for (const m of messages ?? []) {
    const priced = !!m.locked && (m.price_cents ?? 0) > 0;
    const msgStatus: Status = priced
      ? unlockedIds.has(m.id)
        ? "unlocked"
        : "locked"
      : "free";

    const paths = new Set<string>();
    if (m.media_path) paths.add(m.media_path as string);
    if (Array.isArray(m.media_items)) {
      for (const entry of m.media_items) {
        const p = (entry as { path?: unknown })?.path;
        if (typeof p === "string" && p) paths.add(p);
      }
    }
    for (const p of paths) {
      if (!status[p] || RANK[msgStatus] > RANK[status[p]]) status[p] = msgStatus;
    }
  }

  return NextResponse.json({ status });
}
