import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { tgSessionFor } from "@/lib/telegram";
import { ensureMediaCached } from "@/lib/telegramMediaCache";

// A manually triggered upload of a big video runs after the response.
// Pro-plan limit: long slices let most videos finish in one invocation;
// anything bigger resumes on the next cron tick.
export const maxDuration = 800;

type CacheState = {
  /** Clear copy in Saved Messages (and teaser clip for videos) — ready for
   *  instant PPV sends and deliveries. */
  ready: boolean;
  /** An upload/pre-render is currently running. */
  uploading: boolean;
  /** 0–100 for the progress bar. */
  progress: number;
};

/**
 * GET: Saved Messages upload state for every vault file — drives the
 * vault's per-item indicators and progress bars.
 */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const telegram = !!(await tgSessionFor(ownerId).catch(() => null));
  const db = supabaseAdmin();
  type CacheRow = {
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
    .select("media_path, media_type, tg_message_id, teaser_path, caching_at, progress")
    .eq("owner_id", ownerId)
    .limit(2000)) as { data: CacheRow[] | null });
  if (!data) {
    // progress column missing (migration not run yet) — degrade gracefully.
    ({ data } = (await db
      .from("telegram_media_cache")
      .select("media_path, media_type, tg_message_id, teaser_path, caching_at")
      .eq("owner_id", ownerId)
      .limit(2000)) as { data: CacheRow[] | null });
  }

  const status: Record<string, CacheState> = {};
  const staleBefore = Date.now() - 4 * 60_000;
  for (const row of data ?? []) {
    const ready =
      !!row.tg_message_id &&
      (row.media_type !== "video" || !!row.teaser_path);
    const claimedAt = row.caching_at
      ? new Date(String(row.caching_at)).getTime()
      : 0;
    const progress = row.progress;
    // A chunked upload pauses between slices (claim released, progress
    // kept) — still show it as uploading so the bar doesn't flicker away.
    const uploading =
      !ready &&
      (claimedAt > staleBefore ||
        (typeof progress === "number" && progress > 0));
    status[String(row.media_path)] = {
      ready,
      uploading,
      progress: ready
        ? 100
        : typeof progress === "number"
          ? Math.max(0, Math.min(99, progress))
          : 0,
    };
  }
  return NextResponse.json({ telegram, status });
}

/**
 * POST: upload one vault file to Saved Messages now (clear copy + teaser
 * clip for videos). Responds immediately; the work runs in the background
 * and the GET above reports its progress.
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
