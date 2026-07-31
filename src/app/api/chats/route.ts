import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { previewMediaType } from "@/lib/chatPreview";
import { payPerMessageFromMetadata } from "@/lib/payPerMessage";

export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const [chatsRes, catsRes, ownerUserRes] = await Promise.all([
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
    db.auth.admin.getUserById(ownerId),
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
  type Stat = { id: string; preview: Preview | null; unread: number };

  function usablePreview(p: Preview | null | undefined): boolean {
    if (!p) return false;
    if (p.content && p.content.trim()) return true;
    if (p.media_type) return true;
    return false;
  }

  // Latest message preview + unread count per chat via one SQL round trip
  // (owner_chat_stats in schema.sql). Firing 2 queries per chat froze the
  // inbox once an account grew past a few hundred fans.
  let byId = new Map<string, Stat>();
  const { data: statRows, error: statsError } = await db.rpc("owner_chat_stats", {
    p_owner_id: ownerId,
  });

  if (!statsError && Array.isArray(statRows)) {
    byId = new Map(
      (statRows as {
        chat_id: string;
        preview_content: string | null;
        preview_media_type: string | null;
        preview_sender: string | null;
        preview_created_at: string | null;
        unread_count: number;
      }[]).map((row) => [
        String(row.chat_id),
        {
          id: String(row.chat_id),
          preview: row.preview_created_at
            ? {
                chat_id: String(row.chat_id),
                content: row.preview_content,
                media_type: row.preview_media_type,
                created_at: row.preview_created_at,
                sender: row.preview_sender ?? "guest",
              }
            : null,
          unread: Number(row.unread_count) || 0,
        },
      ])
    );
  } else {
    // Function not installed yet: per-chat lookups for the most recent chats
    // only, in small batches, so the endpoint always answers.
    const recent = (chats ?? []).slice(0, 100);
    const BATCH = 20;
    const stats: Stat[] = [];
    for (let i = 0; i < recent.length; i += BATCH) {
      const batch = await Promise.all(
        recent.slice(i, i + BATCH).map(async (chat) => {
          const [{ data: latest }, { count }] = await Promise.all([
            db
              .from("messages")
              .select("chat_id, content, media_type, media_items, created_at, sender")
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
          const preview = latest
            ? {
                chat_id: latest.chat_id as string,
                content: (latest.content as string | null) ?? null,
                media_type: previewMediaType(latest),
                created_at: latest.created_at as string,
                sender: (latest.sender as string) ?? "guest",
              }
            : null;
          return {
            id: chat.id as string,
            preview,
            unread: count ?? 0,
          };
        })
      );
      stats.push(...batch);
    }
    byId = new Map(stats.map((s) => [s.id, s]));
  }

  // Heal rows the RPC left blank (older function, empty latest message, etc.)
  // so chats with a real conversation never stick on "New chat".
  const needsHeal = (chats ?? [])
    .filter((c) => !usablePreview(byId.get(String(c.id))?.preview ?? null))
    .slice(0, 80);
  if (needsHeal.length) {
    const BATCH = 20;
    for (let i = 0; i < needsHeal.length; i += BATCH) {
      const slice = needsHeal.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (chat) => {
          const { data: latest } = await db
            .from("messages")
            .select("chat_id, content, media_type, media_items, created_at, sender")
            .eq("chat_id", chat.id)
            .order("created_at", { ascending: false })
            .limit(5);
          const row = (latest ?? []).find(
            (m) =>
              (typeof m.content === "string" && m.content.trim()) ||
              !!previewMediaType(m) ||
              !!m.media_type
          );
          if (!row) return;
          const prev = byId.get(String(chat.id));
          byId.set(String(chat.id), {
            id: String(chat.id),
            unread: prev?.unread ?? 0,
            preview: {
              chat_id: String(chat.id),
              content: (row.content as string | null) ?? null,
              media_type: previewMediaType(row),
              created_at: row.created_at as string,
              sender: (row.sender as string) ?? "guest",
            },
          });
        })
      );
    }
  }

  const ppm = payPerMessageFromMetadata(
    ownerUserRes.data?.user?.user_metadata ?? {}
  );

  return NextResponse.json({
    ownerId,
    categories: catsRes.data ?? [],
    // So the inbox can show "X free left" next to each fan's name.
    ppm: {
      enabled: ppm.enabled,
      freeCreditCents: ppm.freeCreditCents,
      priceCents: ppm.priceCents,
    },
    chats: (chats ?? []).map(({ chat_category_members, ...c }) => ({
      ...c,
      categories: ((chat_category_members ?? []) as { category_id: string }[]).map(
        (m) => m.category_id
      ),
      preview: byId.get(String(c.id))?.preview ?? null,
      unread: byId.get(String(c.id))?.unread ?? 0,
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
