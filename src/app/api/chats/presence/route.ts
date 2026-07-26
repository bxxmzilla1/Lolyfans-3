import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { broadcast } from "@/lib/realtime";

/**
 * Creator toggles how they appear to ONE specific fan: online (default) or
 * offline. Stored on the chat and broadcast so the fan's chat header flips
 * live. Other chats are unaffected.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId, online } = await req.json();
  if (!chatId || typeof online !== "boolean") {
    return NextResponse.json(
      { error: "chatId and online (boolean) required" },
      { status: 400 }
    );
  }

  const { data: chat, error } = await supabaseAdmin()
    .from("chats")
    .update({ owner_appears_offline: !online })
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  await broadcast(`chat:${chatId}`, "owner-presence", { online });

  return NextResponse.json({ ok: true, online });
}
