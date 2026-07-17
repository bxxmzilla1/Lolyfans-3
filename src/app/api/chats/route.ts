import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  // One round trip: chats, recent messages (previews + unread counts) and
  // categories all load in parallel instead of waiting on each other.
  const [chatsRes, msgsRes, catsRes] = await Promise.all([
    db
      .from("chats")
      .select("*, invites(label, code), chat_category_members(category_id)")
      .eq("owner_id", ownerId)
      .order("last_message_at", { ascending: false }),
    db
      .from("messages")
      .select("chat_id, content, media_type, created_at, sender, chats!inner(owner_id)")
      .eq("chats.owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(1000),
    db
      .from("chat_categories")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true }),
  ]);

  const { data: chats, error } = chatsRes;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach a preview of the latest message and an unread count per chat
  type Preview = { chat_id: string; content: string | null; media_type: string | null; created_at: string; sender: string };
  const previews: Record<string, Preview> = {};
  const unread: Record<string, number> = {};
  const lastRead = new Map((chats ?? []).map((c) => [c.id, c.last_read_at]));
  for (const m of msgsRes.data ?? []) {
    if (!previews[m.chat_id]) {
      previews[m.chat_id] = {
        chat_id: m.chat_id,
        content: m.content,
        media_type: m.media_type,
        created_at: m.created_at,
        sender: m.sender,
      };
    }
    const readAt = lastRead.get(m.chat_id);
    if (m.sender === "guest" && (!readAt || m.created_at > readAt)) {
      unread[m.chat_id] = (unread[m.chat_id] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    ownerId,
    categories: catsRes.data ?? [],
    chats: (chats ?? []).map(({ chat_category_members, ...c }) => ({
      ...c,
      categories: ((chat_category_members ?? []) as { category_id: string }[]).map(
        (m) => m.category_id
      ),
      preview: previews[c.id] ?? null,
      unread: unread[c.id] ?? 0,
    })),
  });
}

/** Rename a chat (owner's custom display name; null clears it). */
export async function PATCH(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId, customName } = await req.json();
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from("chats")
    .update({ custom_name: customName?.trim() || null })
    .eq("id", chatId)
    .eq("owner_id", ownerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
