import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { mediaUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

type StatRow = {
  chat_id: string;
  preview_content: string | null;
  preview_media_type: string | null;
  preview_sender: string | null;
  preview_created_at: string | null;
  unread_count: number;
};

/**
 * Lightweight poll for the Lolyfans desktop app: who this account is, how
 * many fan messages are unread, and the chats with unread messages (for
 * badges and desktop notifications). Uses the account's own login cookie —
 * the app keeps one browser session per creator account.
 */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  const [{ data: userRes }, { data: statRows }] = await Promise.all([
    db.auth.admin.getUserById(ownerId),
    db.rpc("owner_chat_stats", { p_owner_id: ownerId }),
  ]);

  const meta = (userRes?.user?.user_metadata ?? {}) as {
    display_name?: string;
    avatar_path?: string;
  };

  // Match the inbox: only fans with a verified card are listed/counted.
  const { data: cardChats } = await db
    .from("chats")
    .select("id")
    .eq("owner_id", ownerId)
    .not("stripe_payment_method_id", "is", null);
  const cardIds = new Set((cardChats ?? []).map((c) => String(c.id)));

  const rows = ((Array.isArray(statRows) ? statRows : []) as StatRow[]).filter((r) =>
    cardIds.has(String(r.chat_id))
  );
  const withUnread = rows
    .filter((r) => Number(r.unread_count) > 0)
    .sort((a, b) => +new Date(b.preview_created_at ?? 0) - +new Date(a.preview_created_at ?? 0))
    .slice(0, 20);

  let names = new Map<string, string>();
  if (withUnread.length) {
    const { data: chats } = await db
      .from("chats")
      .select("id, guest_name, custom_name")
      .in(
        "id",
        withUnread.map((r) => r.chat_id)
      );
    names = new Map(
      (chats ?? []).map((c) => [
        String(c.id),
        ((c.custom_name as string | null) || (c.guest_name as string) || "Fan").trim(),
      ])
    );
  }

  const previewText = (r: StatRow) =>
    r.preview_content?.trim() ||
    (r.preview_media_type === "video"
      ? "Sent a video"
      : r.preview_media_type === "image"
        ? "Sent a photo"
        : r.preview_media_type === "audio"
          ? "Sent a voice note"
          : "New message");

  return NextResponse.json({
    ownerId,
    name: meta.display_name || "Lolyfans",
    avatarUrl: meta.avatar_path ? mediaUrl(meta.avatar_path) : null,
    unread: rows.reduce((sum, r) => sum + (Number(r.unread_count) || 0), 0),
    chats: withUnread.map((r) => ({
      chatId: r.chat_id,
      fanName: names.get(String(r.chat_id)) ?? "Fan",
      unread: Number(r.unread_count) || 0,
      preview: previewText(r),
      // Only fan-sent previews should trigger a notification.
      fromFan: (r.preview_sender ?? "guest") === "guest",
      at: r.preview_created_at,
    })),
  });
}
