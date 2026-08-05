import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { previewMediaType } from "@/lib/chatPreview";

/**
 * Creator sidebar: Chat-per-minute fans only (purple + gold star in the UI).
 */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: chats, error } = await db
    .from("chats")
    .select(
      "id, guest_name, custom_name, last_message_at, last_read_at, stripe_payment_method_id, cpm"
    )
    .eq("owner_id", ownerId)
    .eq("cpm", true)
    .eq("pending", false)
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (error) {
    // Column missing until migration runs — return empty rather than 500.
    if (/cpm|column/i.test(error.message)) {
      return NextResponse.json({ chats: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (chats ?? []).map((c) => c.id as string);
  type Preview = {
    chat_id: string;
    content: string | null;
    media_type: string | null;
  };
  const previewById = new Map<string, Preview>();
  if (ids.length) {
    const { data: msgs } = await db
      .from("messages")
      .select("chat_id, content, media_type, created_at")
      .in("chat_id", ids)
      .order("created_at", { ascending: false })
      .limit(ids.length * 3);
    for (const m of msgs ?? []) {
      const id = m.chat_id as string;
      if (previewById.has(id)) continue;
      previewById.set(id, {
        chat_id: id,
        content: (m.content as string | null) ?? null,
        media_type: previewMediaType(m),
      });
    }
  }

  return NextResponse.json({
    chats: (chats ?? []).map((c) => {
      const preview = previewById.get(c.id as string);
      const unread =
        c.last_read_at && c.last_message_at
          ? new Date(c.last_message_at as string) >
            new Date(c.last_read_at as string)
            ? 1
            : 0
          : 0;
      return {
        id: c.id,
        guest_name: c.guest_name,
        custom_name: c.custom_name,
        last_message_at: c.last_message_at,
        hasCard: !!c.stripe_payment_method_id,
        unread,
        preview: preview
          ? { content: preview.content, media_type: preview.media_type }
          : null,
      };
    }),
  });
}
