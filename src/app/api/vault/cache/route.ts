import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { tgSessionFor } from "@/lib/telegram";
import { ensureMediaCached } from "@/lib/telegramMediaCache";

// One upload slice runs inside the request (not after()) so Vercel can't
// kill it the moment the response is sent. The client resumes until done.
export const maxDuration = 800;

type CacheState = {
  /** Clear copy in Saved Messages (and teaser clip for videos) — ready for
   *  instant PPV sends and deliveries. */
  ready: boolean;
  /** A worker is actively uploading right now (fresh heartbeat). */
  uploading: boolean;
  /** 0–100 for the progress bar. */
  progress: number;
};

const STALE_MS = 90_000;

function rowState(row: {
  media_type: string;
  tg_message_id: number | null;
  teaser_path: string | null;
  caching_at: string | null;
  progress?: number | null;
}): CacheState {
  const ready =
    !!row.tg_message_id &&
    (row.media_type !== "video" || !!row.teaser_path);
  const claimedAt = row.caching_at
    ? new Date(String(row.caching_at)).getTime()
    : 0;
  const uploading = !ready && claimedAt > Date.now() - STALE_MS;
  const progress = row.progress;
  return {
    ready,
    uploading,
    progress: ready
      ? 100
      : typeof progress === "number"
        ? Math.max(0, Math.min(99, progress))
        : 0,
  };
}

/**
 * GET: Saved Messages upload state for every vault file — drives the
 * vault's per-item indicators and the main progress bar.
 */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const telegram = !!(await tgSessionFor(ownerId).catch(() => null));
  const db = supabaseAdmin();
  type CacheRow = {
    id?: string;
    media_path: string;
    media_type: string;
    tg_message_id: number | null;
    teaser_path: string | null;
    caching_at: string | null;
    progress?: number | null;
  };
  let data: CacheRow[] | null = null;
  ({ data } = (await db
    .from("telegram_media_cache")
    .select(
      "id, media_path, media_type, tg_message_id, teaser_path, caching_at, progress"
    )
    .eq("owner_id", ownerId)
    .limit(2000)) as { data: CacheRow[] | null });
  if (!data) {
    ({ data } = (await db
      .from("telegram_media_cache")
      .select("id, media_path, media_type, tg_message_id, teaser_path, caching_at")
      .eq("owner_id", ownerId)
      .limit(2000)) as { data: CacheRow[] | null });
  }

  // Drop dead claims so unfinished items become clickable again quickly.
  const staleBefore = Date.now() - STALE_MS;
  const staleIds: string[] = [];
  for (const row of data ?? []) {
    if (!row.id || row.tg_message_id) continue;
    const claimedAt = row.caching_at
      ? new Date(String(row.caching_at)).getTime()
      : 0;
    if (claimedAt > 0 && claimedAt <= staleBefore) {
      staleIds.push(String(row.id));
      row.caching_at = null;
    }
  }
  if (staleIds.length) {
    void db
      .from("telegram_media_cache")
      .update({ caching_at: null })
      .in("id", staleIds)
      .then(() => {}, () => {});
  }

  const status: Record<string, CacheState> = {};
  let readyCount = 0;
  let uploadingCount = 0;
  let uploadingProgressSum = 0;
  for (const row of data ?? []) {
    const state = rowState(row);
    status[String(row.media_path)] = state;
    if (state.ready) readyCount += 1;
    if (state.uploading || (!state.ready && state.progress > 0)) {
      // Count paused mid-upload too so the main bar stays visible.
      if (state.uploading) {
        uploadingCount += 1;
        uploadingProgressSum += state.progress;
      } else if (state.progress > 0) {
        uploadingCount += 1;
        uploadingProgressSum += state.progress;
      }
    }
  }

  return NextResponse.json({
    telegram,
    status,
    summary: {
      ready: readyCount,
      uploading: uploadingCount,
      progress:
        uploadingCount > 0
          ? Math.round(uploadingProgressSum / uploadingCount)
          : 0,
    },
  });
}

/**
 * POST: run one upload slice for a vault file (clear copy + teaser).
 * Returns when the slice finishes or the file is ready — the vault client
 * keeps calling until `ready` is true.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const mediaPath = String(body.mediaPath || "").trim();
  const mediaType = body.mediaType === "video" ? "video" : "image";
  if (!mediaPath) {
    return NextResponse.json({ error: "mediaPath required" }, { status: 400 });
  }

  const session = await tgSessionFor(ownerId);
  if (!session) {
    return NextResponse.json(
      { error: "Connect your Telegram account first (Settings → Telegram)" },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  // Steal any dead claim so a stuck row can't block this slice.
  await db
    .from("telegram_media_cache")
    .update({ caching_at: null })
    .eq("owner_id", ownerId)
    .eq("media_path", mediaPath)
    .is("tg_message_id", null);

  let errorMsg: string | null = null;
  try {
    // ~55s of upload work per request — short enough to finish reliably,
    // long enough to move a meaningful chunk. Client resumes until ready.
    await ensureMediaCached({
      ownerId,
      session,
      mediaPath,
      mediaType,
      budgetMs: 55_000,
    });
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : "Upload failed";
    console.error("[vault/cache] upload slice failed", mediaPath, errorMsg);
  }

  type CacheRow = {
    media_type: string;
    tg_message_id: number | null;
    teaser_path: string | null;
    caching_at: string | null;
    progress?: number | null;
  };
  let row: CacheRow | null = null;
  ({ data: row } = (await db
    .from("telegram_media_cache")
    .select("media_type, tg_message_id, teaser_path, caching_at, progress")
    .eq("owner_id", ownerId)
    .eq("media_path", mediaPath)
    .maybeSingle()) as { data: CacheRow | null });

  const state = row
    ? rowState({ ...row, media_type: mediaType })
    : { ready: false, uploading: false, progress: 0 };

  return NextResponse.json({
    ok: !errorMsg,
    error: errorMsg,
    ready: state.ready,
    uploading: state.uploading,
    progress: state.progress,
  });
}
