import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Normalize a typed Telegram handle into a peer key GramJS accepts. */
function normalizePeer(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // Already a structured peer from our dialog list.
  if (
    s.startsWith("user:") ||
    s.startsWith("channel:") ||
    s.startsWith("chat:")
  ) {
    return s;
  }
  // Phone number.
  if (/^\+?\d{6,15}$/.test(s)) {
    return s.startsWith("+") ? s : `+${s}`;
  }
  // @username or bare username.
  const user = s.replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "");
  if (user.length < 3) return null;
  return `@${user}`;
}

/**
 * Link a Telegram peer to a Chat-per-minute fan so the creator can open
 * their DM in the Telegram inbox. Does not send a message — that happens
 * in the Telegram chat view once it opens.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "").trim();
  const peer = normalizePeer(String(body.peer || ""));
  if (!chatId || !peer) {
    return NextResponse.json(
      { error: "Enter a valid Telegram @username or phone number" },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, owner_id, cpm")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat || chat.owner_id !== ownerId || !chat.cpm) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const { error } = await db
    .from("chats")
    .update({ tg_peer: peer })
    .eq("id", chatId);
  if (error) {
    if (/tg_peer|column/i.test(error.message)) {
      return NextResponse.json(
        { error: "Run the Chat per minute Telegram peer DB migration first" },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, peer });
}
