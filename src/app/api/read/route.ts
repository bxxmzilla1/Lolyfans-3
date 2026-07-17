import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

/** Marks a chat as read by the owner (clears its unread badge). */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId } = await req.json();
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  await supabaseAdmin()
    .from("chats")
    .update({ last_read_at: new Date().toISOString() })
    .eq("id", chatId)
    .eq("owner_id", ownerId);

  return NextResponse.json({ ok: true });
}
