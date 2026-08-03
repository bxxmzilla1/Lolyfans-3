import "server-only";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mediaUrl } from "@/lib/utils";
import { tgCacheMedia, tgBuildTeaserClip } from "@/lib/telegram";

/**
 * Vault media pre-uploaded to Telegram, so sends never wait on an upload:
 *
 *  - `tg_message_id`: a clear copy in the creator's Saved Messages. Free
 *    sends and unlock deliveries re-send it by reference — an instant
 *    server-side copy instead of a minutes-long re-upload.
 *  - `teaser_path`: a pre-rendered badge-less blurred clip (videos only),
 *    stored in the media bucket. Locked video sends only overlay the price
 *    badge on this tiny clip, so they're as fast as locked image sends.
 *
 * Rows are filled by `ensureMediaCached` — kicked off when a vault item is
 * uploaded, when something is sent, and by the cron backfill worker that
 * walks the whole vault a few items per tick.
 */

export type MediaCache = {
  tgMessageId: number | null;
  teaserPath: string | null;
};

const TABLE = "telegram_media_cache";

/** Where a video's pre-rendered teaser clip lives in the media bucket. */
function teaserStoragePath(ownerId: string, mediaPath: string): string {
  const hash = createHash("sha1").update(mediaPath).digest("hex");
  return `tg-teasers/${ownerId}/${hash}.mp4`;
}

/** Cached Telegram ids/paths for a vault file, or null if nothing yet. */
export async function getMediaCache(
  ownerId: string,
  mediaPath: string
): Promise<MediaCache | null> {
  const { data } = await supabaseAdmin()
    .from(TABLE)
    .select("tg_message_id, teaser_path")
    .eq("owner_id", ownerId)
    .eq("media_path", mediaPath)
    .maybeSingle();
  if (!data) return null;
  return {
    tgMessageId: (data.tg_message_id as number | null) ?? null,
    teaserPath: (data.teaser_path as string | null) ?? null,
  };
}

/** Fetch a pre-rendered teaser clip (small file) into a Buffer. */
export async function downloadTeaserClip(
  teaserPath: string
): Promise<Buffer | null> {
  try {
    const res = await fetch(mediaUrl(teaserPath));
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Make sure this vault file is fully cached on Telegram: upload the clear
 * copy to Saved Messages and (for videos) pre-render the blurred teaser
 * clip. Idempotent and safe to call concurrently — an in-flight claim on
 * the row keeps two workers from uploading the same file twice.
 */
export async function ensureMediaCached(opts: {
  ownerId: string;
  session: string;
  mediaPath: string;
  mediaType: "image" | "video";
}): Promise<MediaCache | null> {
  const db = supabaseAdmin();
  const fetchRow = async () => {
    const { data } = await db
      .from(TABLE)
      .select("id, tg_message_id, teaser_path")
      .eq("owner_id", opts.ownerId)
      .eq("media_path", opts.mediaPath)
      .maybeSingle();
    return data as {
      id: string;
      tg_message_id: number | null;
      teaser_path: string | null;
    } | null;
  };

  let row = await fetchRow();
  if (!row) {
    await db
      .from(TABLE)
      .upsert(
        {
          owner_id: opts.ownerId,
          media_path: opts.mediaPath,
          media_type: opts.mediaType,
        },
        { onConflict: "owner_id,media_path", ignoreDuplicates: true }
      );
    row = await fetchRow();
  }
  if (!row) return null;

  const needsCopy = !row.tg_message_id;
  const needsTeaser = opts.mediaType === "video" && !row.teaser_path;
  if (!needsCopy && !needsTeaser) {
    return { tgMessageId: row.tg_message_id, teaserPath: row.teaser_path };
  }

  // Claim the row (or steal a claim that's been stuck for 10+ minutes —
  // a worker killed mid-upload). Losing the claim means someone else is
  // already on it, so just report what exists now.
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: claimed } = await db
    .from(TABLE)
    .update({ caching_at: new Date().toISOString() })
    .eq("id", row.id)
    .or(`caching_at.is.null,caching_at.lt.${stale}`)
    .select("id");
  if (!claimed?.length) {
    return { tgMessageId: row.tg_message_id, teaserPath: row.teaser_path };
  }

  let tgMessageId = row.tg_message_id;
  let teaserPath = row.teaser_path;

  // Progress for the vault UI (0–100). Best-effort: the column may not
  // exist until the migration runs, and supabase-js reports (not throws)
  // errors, so a missing column just no-ops.
  const rowId = row.id;
  const setProgress = (value: number | null) => {
    void db.from(TABLE).update({ progress: value }).eq("id", rowId).then(
      () => {},
      () => {}
    );
  };
  // Telegram upload is the long part: map its 0..1 onto 10–80. Throttled so
  // a big video doesn't hammer the database.
  let lastProgressWrite = 0;
  const onUploadProgress = (fraction: number) => {
    const now = Date.now();
    if (now - lastProgressWrite < 1500) return;
    lastProgressWrite = now;
    setProgress(10 + Math.round(fraction * 70));
  };

  setProgress(5);
  try {
    if (needsCopy) {
      const id = await tgCacheMedia({
        session: opts.session,
        mediaPath: opts.mediaPath,
        mediaType: opts.mediaType,
        onProgress: onUploadProgress,
      });
      if (id) {
        tgMessageId = id;
        await db.from(TABLE).update({ tg_message_id: id }).eq("id", row.id);
      }
    }
    setProgress(needsTeaser ? 85 : 95);
    if (needsTeaser) {
      const clip = await tgBuildTeaserClip(opts.mediaPath);
      const path = teaserStoragePath(opts.ownerId, opts.mediaPath);
      const { error } = await db.storage
        .from("media")
        .upload(path, clip, { contentType: "video/mp4", upsert: true });
      if (!error) {
        teaserPath = path;
        await db.from(TABLE).update({ teaser_path: path }).eq("id", row.id);
      }
    }
  } finally {
    const complete =
      !!tgMessageId && (opts.mediaType !== "video" || !!teaserPath);
    setProgress(complete ? 100 : null);
    try {
      await db.from(TABLE).update({ caching_at: null }).eq("id", row.id);
    } catch {
      // stale claims self-expire after 10 minutes anyway
    }
  }
  return { tgMessageId, teaserPath };
}

/**
 * Backfill worker: cache up to `limit` not-yet-cached vault items for this
 * creator (newest first). Small batches keep each cron tick short and stay
 * clear of Telegram's flood limits; the whole vault fills in over successive
 * ticks. Returns how many items were processed.
 */
export async function cacheVaultBacklog(
  ownerId: string,
  session: string,
  limit = 2
): Promise<number> {
  const db = supabaseAdmin();
  const [{ data: items }, { data: rows }] = await Promise.all([
    db
      .from("vault_items")
      .select("media_path, media_type")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from(TABLE)
      .select("media_path, tg_message_id, teaser_path")
      .eq("owner_id", ownerId)
      .limit(1000),
  ]);
  const byPath = new Map(
    (rows ?? []).map((r) => [String(r.media_path), r])
  );

  let done = 0;
  for (const item of items ?? []) {
    if (done >= limit) break;
    const mediaPath = String(item.media_path || "");
    if (!mediaPath) continue;
    const mediaType = item.media_type === "video" ? "video" : "image";
    const row = byPath.get(mediaPath);
    const complete =
      !!row?.tg_message_id && (mediaType !== "video" || !!row?.teaser_path);
    if (complete) continue;
    try {
      await ensureMediaCached({ ownerId, session, mediaPath, mediaType });
      done++;
    } catch {
      // one broken file shouldn't stall the backfill
    }
  }
  return done;
}
