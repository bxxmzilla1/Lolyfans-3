import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { tgSessionFor } from "@/lib/telegram";
import { ensureMediaCached } from "@/lib/telegramMediaCache";

// Manual upload only — big videos run after the response.
export const maxDuration = 800;

type CacheState = {
  /** Clear copy in Saved Messages (and teaser clip for videos) — ready for
   *  instant PPV sends and deliveries. */
  ready: boolean;
  /** A worker is actively uploading right now (fresh heartbeat). */
  uploading: boolean;
  /** 0–100 for the progress bar. Non-zero while `uploading` is false means
   *  a chunked upload paused mid-file — tap the badge to resume. */
  progress: number;
};

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
    // progress column missing (migration not run yet) — degrade gracefully.
    ({ data } = (await db
      .from("telegram_media_cache")
      .select("id, media_path, media_type, tg_message_id, teaser_path, caching_at")
      .eq("owner_id", ownerId)
      .limit(2000)) as { data: CacheRow[] | null });
  }

  // Drop dead claims left by killed workers / the old auto-backfill so every
  // unfinished item shows a clickable upload button again.
  const staleBefore = Date.now() - 4 * 60_000;
  const staleIds: string[] = [];
  for (const row of data ?? []) {
    if (!row.id || row.tg_message_id) continue;
    const claimedAt = row.caching_at
      ? new Date(String(row.caching_at)).getTime()
      : 0;
    if (claimedAt > 0 && claimedAt <= staleBefore) {
      staleIds.push(String(row.id));
      row.caching_at = null;
      row.progress = null;
    }
  }
  if (staleIds.length) {
    void db
      .from("telegram_media_cache")
      .update({ caching_at: null, progress: null })
      .in("id", staleIds)
      .then(() => {}, () => {});
  }

  const status: Record<string, CacheState> = {};
  let readyCount = 0;
  let uploadingCount = 0;
  let uploadingProgressSum = 0;
  for (const row of data ?? []) {
    const ready =
      !!row.tg_message_id &&
      (row.media_type !== "video" || !!row.teaser_path);
    const claimedAt = row.caching_at
      ? new Date(String(row.caching_at)).getTime()
      : 0;
    const progress = row.progress;
    const uploading = !ready && claimedAt > staleBefore;
    const pct = ready
      ? 100
      : typeof progress === "number"
        ? Math.max(0, Math.min(99, progress))
        : 0;
    status[String(row.media_path)] = { ready, uploading, progress: pct };
    if (ready) readyCount += 1;
    if (uploading) {
      uploadingCount += 1;
      uploadingProgressSum += pct;
    }
  }

  return NextResponse.json({
    telegram,
    status,
    summary: {
      ready: readyCount,
      uploading: uploadingCount,
      // Average progress across active uploads (0 when none).
      progress:
        uploadingCount > 0
          ? Math.round(uploadingProgressSum / uploadingCount)
          : 0,
    },
  });
}

/**
 * POST: upload one vault file to Saved Messages now (clear copy + teaser
 * clip for videos). Manual only — responds immediately; work runs in the
 * background and the GET above reports its progress.
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

  // Force-reclaim this row so a stuck claim from an old auto-upload can't
  // swallow the click. Manual uploads always win.
  await supabaseAdmin()
    .from("telegram_media_cache")
    .update({ caching_at: null })
    .eq("owner_id", ownerId)
    .eq("media_path", mediaPath)
    .is("tg_message_id", null);

  after(async () => {
    try {
      await ensureMediaCached({
        ownerId,
        session,
        mediaPath,
        mediaType,
        budgetMs: 700_000,
      });
    } catch {
      // the row's progress resets to null; the creator can retry
    }
  });
  return NextResponse.json({ ok: true });
}
