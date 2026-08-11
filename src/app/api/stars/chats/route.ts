import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Creator: list Mini App / Stars chats. */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabaseAdmin()
    .from("stars_chats")
    .select("id, tg_user_id, username, first_name, last_name, last_message_at")
    .eq("owner_id", ownerId)
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (error) {
    if (/stars_chats|schema cache|does not exist/i.test(error.message)) {
      return NextResponse.json({ chats: [], needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const chats = data ?? [];
  const previews: Record<string, string> = {};
  if (chats.length) {
    const ids = chats.map((c) => c.id);
    const { data: msgs } = await supabaseAdmin()
      .from("stars_messages")
      .select("chat_id, content, media_type, locked, price_stars, created_at")
      .in("chat_id", ids)
      .order("created_at", { ascending: false })
      .limit(200);
    for (const m of msgs ?? []) {
      if (previews[m.chat_id]) continue;
      if (m.locked && m.price_stars) {
        previews[m.chat_id] = `🔒 ${m.price_stars} Stars`;
      } else if (m.media_type) {
        previews[m.chat_id] = m.media_type === "video" ? "Video" : "Photo";
      } else {
        previews[m.chat_id] = (m.content || "").slice(0, 80);
      }
    }
  }

  return NextResponse.json({
    chats: chats.map((c) => ({
      id: c.id,
      tgUserId: c.tg_user_id,
      username: c.username,
      name:
        [c.first_name, c.last_name].filter(Boolean).join(" ") ||
        (c.username ? `@${c.username}` : `User ${c.tg_user_id}`),
      lastMessageAt: c.last_message_at,
      preview: previews[c.id] || "",
    })),
  });
}
