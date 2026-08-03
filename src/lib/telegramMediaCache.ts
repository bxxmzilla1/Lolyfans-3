import "server-only";
import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mediaUrl } from "@/lib/utils";
import {
  tgCacheMedia,
  tgBuildTeaserClip,
  tgChunkedUploadSlice,
  tgFinalizeChunkedUpload,
  TG_PART_SIZE,
} from "@/lib/telegram";

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

/** Files above this go through the resumable chunked uploader. */
const CHUNK_THRESHOLD = 30 * 1024 * 1024;

/**
 * A claim older than this is considered dead and can be stolen. Active
 * workers heartbeat `caching_at` every few seconds while uploading, so
 * only a killed invocation ever goes stale.
 */
const STALE_CLAIM_MS = 4 * 60_000;

/** Random 63-bit id (decimal string) for Telegram's saveBigFilePart. */
function randomFileId(): string {
  const buf = randomBytes(8);
  buf[0] &= 0x7f;
  return BigInt("0x" + buf.toString("hex")).toString();
}

/** File size in bytes via HEAD (or a 1-byte ranged GET as fallback). */
async function fileSizeOf(url: string): Promise<number> {
  try {
    const head = await fetch(url, { method: "HEAD" });
    const len = Number(head.headers.get("content-length"));
    if (head.ok && Number.isFinite(len) && len > 0) return len;
  } catch {
    // fall through to the ranged GET
  }
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
    const total = Number((res.headers.get("content-range") || "").split("/")[1]);
    if (Number.isFinite(total) && total > 0) return total;
  } catch {
    // size unknown — caller falls back to the single-shot upload
  }
  return 0;
}

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

type CacheRow = {
  id: string;
  tg_message_id: number | null;
  teaser_path: string | null;
  upload_file_id?: string | null;
  upload_parts_done?: number | null;
  upload_size?: number | null;
};

/**
 * Make sure this vault file is fully cached on Telegram: upload the clear
 * copy to Saved Messages and (for videos) pre-render the blurred teaser
 * clip. Idempotent and safe to call concurrently — an in-flight claim on
 * the row keeps two workers from uploading the same file twice.
 *
 * Large files use a resumable chunked upload: parts are pushed until the
 * time budget runs out, the resume point is persisted, and the next call
 * (cron tick or badge click) picks up where this one stopped. Returns null
 * while an upload is still in progress.
 */
export async function ensureMediaCached(opts: {
  ownerId: string;
  session: string;
  mediaPath: string;
  mediaType: "image" | "video";
  /** How long this invocation may spend uploading (default 4 minutes). */
  budgetMs?: number;
}): Promise<MediaCache | null> {
  const db = supabaseAdmin();
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);

  // The upload_* columns arrive with a later migration; fall back to the
  // basic shape (and the single-shot uploader) when they're missing.
  let chunkable = true;
  const fetchRow = async (): Promise<CacheRow | null> => {
    const { data, error } = await db
      .from(TABLE)
      .select(
        "id, tg_message_id, teaser_path, upload_file_id, upload_parts_done, upload_size"
      )
      .eq("owner_id", opts.ownerId)
      .eq("media_path", opts.mediaPath)
      .maybeSingle();
    if (!error) return data as CacheRow | null;
    chunkable = false;
    const { data: basic } = await db
      .from(TABLE)
      .select("id, tg_message_id, teaser_path")
      .eq("owner_id", opts.ownerId)
      .eq("media_path", opts.mediaPath)
      .maybeSingle();
    return basic as CacheRow | null;
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

  // Claim the row (or steal a claim whose worker died — live workers
  // heartbeat the claim, so stale means dead). Losing the claim means
  // someone else is on it; just report what exists now.
  const stale = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
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
  let inProgress = false;

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
  // Single-shot uploads: map GramJS's 0..1 onto 10–80 and heartbeat the
  // claim. Throttled so a big video doesn't hammer the database.
  let lastProgressWrite = 0;
  const onUploadProgress = (fraction: number) => {
    const now = Date.now();
    if (now - lastProgressWrite < 1500) return;
    lastProgressWrite = now;
    void db
      .from(TABLE)
      .update({
        progress: 10 + Math.round(fraction * 70),
        caching_at: new Date().toISOString(),
      })
      .eq("id", rowId)
      .then(() => {}, () => {});
  };

  setProgress(5);
  try {
    if (needsCopy) {
      const url = mediaUrl(opts.mediaPath);
      const size = await fileSizeOf(url);

      if (chunkable && size > CHUNK_THRESHOLD) {
        // --- Resumable chunked path -----------------------------------
        let fileId = row.upload_file_id ?? null;
        let partsDone = Number(row.upload_parts_done ?? 0);
        if (!fileId || Number(row.upload_size ?? 0) !== size) {
          fileId = randomFileId();
          partsDone = 0;
          await db
            .from(TABLE)
            .update({
              upload_file_id: fileId,
              upload_parts_done: 0,
              upload_size: size,
            })
            .eq("id", row.id);
        }
        const totalParts = Math.ceil(size / TG_PART_SIZE);
        // Keep a minute in reserve for the finalize + teaser steps.
        const sliceDeadline = Math.max(
          Date.now() + 15_000,
          deadline - 60_000
        );
        const newDone = await tgChunkedUploadSlice({
          session: opts.session,
          url,
          size,
          fileId,
          partsDone,
          deadline: sliceDeadline,
          onParts: (done, total) => {
            // Persist the resume point, heartbeat the claim, move the bar.
            void db
              .from(TABLE)
              .update({
                upload_parts_done: done,
                caching_at: new Date().toISOString(),
                progress: 5 + Math.round((done / total) * 70),
              })
              .eq("id", row.id)
              .then(() => {}, () => {});
          },
        });
        await db
          .from(TABLE)
          .update({ upload_parts_done: newDone })
          .eq("id", row.id);

        if (newDone < totalParts) {
          // Out of time — release the claim and let the next slice resume.
          inProgress = true;
          return null;
        }

        setProgress(80);
        try {
          const id = await tgFinalizeChunkedUpload({
            session: opts.session,
            mediaPath: opts.mediaPath,
            mediaType: opts.mediaType,
            fileId,
            size,
          });
          if (id) {
            tgMessageId = id;
            await db
              .from(TABLE)
              .update({
                tg_message_id: id,
                upload_file_id: null,
                upload_parts_done: null,
                upload_size: null,
              })
              .eq("id", row.id);
          }
        } catch (err) {
          // Parts likely expired server-side — reset so the next run
          // starts a fresh upload instead of retrying a dead finalize.
          await db
            .from(TABLE)
            .update({
              upload_file_id: null,
              upload_parts_done: null,
              upload_size: null,
            })
            .eq("id", row.id);
          throw err;
        }
      } else {
        // --- Small file: single-shot upload ---------------------------
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
    // A paused chunked upload keeps its progress so the bar survives
    // between slices; a genuine failure clears it.
    if (complete) setProgress(100);
    else if (!inProgress) setProgress(null);
    try {
      await db.from(TABLE).update({ caching_at: null }).eq("id", row.id);
    } catch {
      // stale claims self-expire anyway
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
  limit = 2,
  budgetMs = 240_000
): Promise<number> {
  const db = supabaseAdmin();
  const deadline = Date.now() + budgetMs;
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
    const remaining = deadline - Date.now();
    if (remaining < 20_000) break;
    const mediaPath = String(item.media_path || "");
    if (!mediaPath) continue;
    const mediaType = item.media_type === "video" ? "video" : "image";
    const row = byPath.get(mediaPath);
    const complete =
      !!row?.tg_message_id && (mediaType !== "video" || !!row?.teaser_path);
    if (complete) continue;
    try {
      await ensureMediaCached({
        ownerId,
        session,
        mediaPath,
        mediaType,
        budgetMs: remaining,
      });
      done++;
    } catch {
      // one broken file shouldn't stall the backfill
    }
  }
  return done;
}
