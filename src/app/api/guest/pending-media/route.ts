import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestChats, ownerProfiles } from "@/lib/guest";
import { mediaItemsFromMessage } from "@/lib/utils";

/**
 * Oldest undecided creator photo/video across this guest's chats — drives the
 * fullscreen Accept/Reject gate on Home (and the rest of the fan shell) even
 * when the chat page isn't open.
 */
export async function GET(req: NextRequest) {
  const chats = await guestChats(req.headers);
  if (!chats.length) return NextResponse.json({ pending: null });

  const chatIds = chats.map((c) => c.id);
  const db = supabaseAdmin();
  const { data: rows } = await db
    .from("messages")
    .select("*")
    .in("chat_id", chatIds)
    .eq("sender", "owner")
    .is("fan_decision", null)
    .order("created_at", { ascending: true })
    .limit(40);

  const candidates = (rows ?? []).filter((m) =>
    mediaItemsFromMessage(m).some((i) => i.type === "image" || i.type === "video")
  );
  if (!candidates.length) return NextResponse.json({ pending: null });

  // Skip anything already paid-unlocked (edge case before fan_decision sync).
  const ids = candidates.map((m) => m.id);
  const { data: unlocks } = await db
    .from("message_unlocks")
    .select("message_id")
    .in("message_id", ids);
  const unlocked = new Set((unlocks ?? []).map((u) => u.message_id as string));
  const message = candidates.find((m) => !unlocked.has(m.id));
  if (!message) return NextResponse.json({ pending: null });

  const chat = chats.find((c) => c.id === message.chat_id);
  const profiles = chat ? await ownerProfiles([chat.owner_id]) : new Map();
  const peerName = chat
    ? profiles.get(chat.owner_id)?.name || "Lolyfans"
    : "Lolyfans";

  return NextResponse.json({
    pending: {
      message: { ...message, unlocked: false },
      peerName,
      chatId: message.chat_id as string,
    },
  });
}
