import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import {
  telegramConfigured,
  tgSessionFor,
  tgListSavedMedia,
  tgSavedMediaThumbs,
} from "@/lib/telegram";

// Initial syncs download a batch of thumbnails from Telegram.
export const maxDuration = 300;

// Thumbnails uploaded per sync; the thumb route self-heals any misses.
const THUMBS_PER_SYNC = 40;

/**
 * Mirror the creator's Telegram Saved Messages into the vault. The creator
 * uploads media in any Telegram app (fast, resumable, no serverless size
 * limits); every photo/video saved there becomes a vault item with
 * media_path "tg:<messageId>". Items whose message was deleted disappear;
 * album memberships survive syncs because rows are stable.
 */
export async function POST() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!telegramConfigured()) {
    return NextResponse.json({ telegram: false, added: 0, removed: 0 });
  }
  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json({ telegram: false, added: 0, removed: 0 });
  }

  let saved;
  try {
    saved = await tgListSavedMedia({ session, limit: 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not read Saved Messages";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("vault_items")
    .select("id, media_path")
    .eq("owner_id", ownerId)
    .like("media_path", "tg:%");
  const have = new Set((existing ?? []).map((r) => String(r.media_path)));
  const seen = new Set(saved.map((s) => `tg:${s.messageId}`));

  // New Saved Messages media → new vault items (message date keeps order).
  const fresh = saved.filter((s) => !have.has(`tg:${s.messageId}`));
  if (fresh.length > 0) {
    const rows = fresh.map((s) => ({
      owner_id: ownerId,
      media_path: `tg:${s.messageId}`,
      media_type: s.kind,
      duration_seconds: s.duration,
      created_at: s.date
        ? new Date(s.date * 1000).toISOString()
        : new Date().toISOString(),
    }));
    const { error } = await db.from("vault_items").insert(rows);
    if (error) {
      // duration_seconds column missing (migration not run yet) — insert
      // without it so the vault still fills.
      await db.from("vault_items").insert(
        rows.map(({ duration_seconds: _duration, ...rest }) => rest)
      );
    }
  }

  // Messages deleted in Saved Messages → items vanish from the vault too.
  const gone = (existing ?? [])
    .filter((r) => !seen.has(String(r.media_path)))
    .map((r) => r.id);
  if (gone.length > 0) {
    await db.from("vault_items").delete().in("id", gone);
  }

  // Grid thumbnails for the newest additions (small downloads, one Telegram
  // connection). Anything missed here is fetched lazily by the thumb route.
  const thumbIds = fresh.slice(0, THUMBS_PER_SYNC).map((s) => s.messageId);
  if (thumbIds.length > 0) {
    try {
      const thumbs = await tgSavedMediaThumbs({ session, messageIds: thumbIds });
      for (const [messageId, buf] of thumbs) {
        await db.storage
          .from("media")
          .upload(`tg-thumbs/${ownerId}/${messageId}.jpg`, buf, {
            contentType: "image/jpeg",
            upsert: true,
          });
      }
    } catch {
      // thumbnails are cosmetic — the sync itself already succeeded
    }
  }

  return NextResponse.json({
    telegram: true,
    added: fresh.length,
    removed: gone.length,
    total: saved.length,
  });
}
