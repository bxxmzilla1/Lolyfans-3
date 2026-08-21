import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

/**
 * Send status for vault media, keyed by storage path (vault items and sends
 * share the same media_path — no re-upload happens on send):
 *
 *   "free"     → sent without a price                   (orange outline)
 *   "locked"   → sent price-locked, fan never unlocked  (red outline)
 *   "unlocked" → sent price-locked and the fan paid     (green outline)
 *
 * Scoped to one Lolyfans chat via ?chatId=…. Paths never sent in that scope
 * are simply absent from the map.
 */

const RANK = { free: 1, locked: 2, unlocked: 3 } as const;
type Status = keyof typeof RANK;

export async function GET(req: NextRequest) {
  try {
    const ownerId = await getOwnerId();
    if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const chatId = req.nextUrl.searchParams.get("chatId");
    if (!chatId) {
      return NextResponse.json({ status: {} });
    }

    const db = supabaseAdmin();
    const { data: chat, error: chatErr } = await db
      .from("chats")
      .select("id")
      .eq("id", chatId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (chatErr) {
      return NextResponse.json({ error: chatErr.message }, { status: 500 });
    }
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    const [{ data: messages, error: msgErr }, { data: unlocks, error: unlockErr }] =
      await Promise.all([
        db
          .from("messages")
          .select("id, media_path, media_items, locked, price_cents")
          .eq("chat_id", chatId)
          .eq("sender", "owner")
          .not("media_path", "is", null),
        db.from("message_unlocks").select("message_id").eq("chat_id", chatId),
      ]);
    if (msgErr) {
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }
    if (unlockErr) {
      return NextResponse.json({ error: unlockErr.message }, { status: 500 });
    }

    const unlockedIds = new Set((unlocks ?? []).map((u) => u.message_id as string));

    // A path may have been sent more than once — keep the strongest signal:
    // unlocked (paid) beats locked (pending) beats free.
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vault status failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
