import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";

export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const [chatsRes, catsRes] = await Promise.all([
    db
      .from("chats")
      .select("*, invites(label, code), chat_category_members(category_id)")
      .eq("owner_id", ownerId)
      .order("last_message_at", { ascending: false }),
    db
      .from("chat_categories")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true }),
  ]);

  const { data: chats, error } = chatsRes;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Preview = {
    chat_id: string;
    content: string | null;
    media_type: string | null;
    created_at: string;
    sender: string;
  };

  // One latest message + unread count per chat (the old global 1000-row fetch
  // missed previews once an owner had more than that many messages total).
  const stats = await Promise.all(
    (chats ?? []).map(async (chat) => {
      const [{ data: latest }, { count }] = await Promise.all([
        db
          .from("messages")
          .select("chat_id, content, media_type, created_at, sender")
          .eq("chat_id", chat.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("chat_id", chat.id)
          .eq("sender", "guest")
          .gt("created_at", chat.last_read_at || "1970-01-01T00:00:00Z"),
      ]);
      return {
        id: chat.id,
        preview: (latest as Preview | null) ?? null,
        unread: count ?? 0,
      };
    })
  );
  const byId = new Map(stats.map((s) => [s.id, s]));

  return NextResponse.json({
    ownerId,
    categories: catsRes.data ?? [],
    chats: (chats ?? []).map(({ chat_category_members, ...c }) => ({
      ...c,
      categories: ((chat_category_members ?? []) as { category_id: string }[]).map(
        (m) => m.category_id
      ),
      preview: byId.get(c.id)?.preview ?? null,
      unread: byId.get(c.id)?.unread ?? 0,
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

/** Delete a chat (and its messages via cascade). Requires the admin code. */
export async function DELETE(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const expected = process.env.ADMIN_CODE;
  if (!expected) {
    return NextResponse.json(
      { error: "Admin code is not configured. Set ADMIN_CODE in the environment." },
      { status: 503 }
    );
  }

  const { chatId, code } = await req.json();
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });
  if (code !== expected) {
    return NextResponse.json({ error: "Invalid admin code" }, { status: 403 });
  }

  const db = supabaseAdmin();
  // Scrub the guest's IP so the deleted chat can't be auto-resumed by device
  const { data: chat } = await db
    .from("chats")
    .select("guest_ip")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  const { error } = await db
    .from("chats")
    .delete()
    .eq("id", chatId)
    .eq("owner_id", ownerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (chat?.guest_ip) {
    await db.from("chats").update({ guest_ip: null }).eq("guest_ip", chat.guest_ip);
  }
  return NextResponse.json({ ok: true });
}
