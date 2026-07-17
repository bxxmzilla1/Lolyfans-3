import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: chats, error } = await db
    .from("chats")
    .select("*, invites(label, code)")
    .eq("owner_id", ownerId)
    .order("last_message_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach a preview of the latest message and an unread count per chat
  const ids = (chats ?? []).map((c) => c.id);
  type Preview = { chat_id: string; content: string | null; media_type: string | null; created_at: string; sender: string };
  const previews: Record<string, Preview> = {};
  const unread: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: msgs } = await db
      .from("messages")
      .select("chat_id, content, media_type, created_at, sender")
      .in("chat_id", ids)
      .order("created_at", { ascending: false });
    const lastRead = new Map((chats ?? []).map((c) => [c.id, c.last_read_at]));
    for (const m of msgs ?? []) {
      if (!previews[m.chat_id]) previews[m.chat_id] = m;
      const readAt = lastRead.get(m.chat_id);
      if (m.sender === "guest" && (!readAt || m.created_at > readAt)) {
        unread[m.chat_id] = (unread[m.chat_id] ?? 0) + 1;
      }
    }
  }

  return NextResponse.json({
    ownerId,
    chats: (chats ?? []).map((c) => ({
      ...c,
      preview: previews[c.id] ?? null,
      unread: unread[c.id] ?? 0,
    })),
  });
}
