import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { broadcast } from "@/lib/realtime";
import { notifyGuestSms, requestOrigin } from "@/lib/smsNotify";
import { parseBlurDrainer } from "@/lib/blurDrainer";

/** Max ids per .in() filter — they travel in the PostgREST request URL. */
const BATCH = 200;
/** Concurrent realtime broadcasts per wave. */
const BROADCAST_BATCH = 50;

/**
 * Send one message (optionally with media) to many of the owner's chats at
 * once. The client resolves the recipient list (categories / online / picked
 * users); the server only trusts chat ids that this owner actually owns.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatIds, content, mediaPath, mediaType, locked, blurDrainer } =
    await req.json();
  if (!Array.isArray(chatIds) || chatIds.length === 0) {
    return NextResponse.json({ error: "Pick at least one recipient" }, { status: 400 });
  }
  if (!content?.trim() && !mediaPath) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const db = supabaseAdmin();
  // Only keep chats this owner owns. PostgREST encodes .in() filters in the
  // request URL, so thousands of ids in one call blow the URL length limit —
  // check ownership in batches instead.
  const uniqueIds = Array.from(
    new Set(chatIds.filter((x): x is string => typeof x === "string" && !!x))
  );
  const targetIds: string[] = [];
  for (let i = 0; i < uniqueIds.length; i += BATCH) {
    const { data: owned, error: ownErr } = await db
      .from("chats")
      .select("id")
      .eq("owner_id", ownerId)
      .in("id", uniqueIds.slice(i, i + BATCH));
    if (ownErr) {
      return NextResponse.json({ error: ownErr.message }, { status: 500 });
    }
    targetIds.push(...(owned ?? []).map((c) => c.id));
  }
  if (targetIds.length === 0) {
    return NextResponse.json({ error: "No valid recipients" }, { status: 400 });
  }

  // BlurDrainer (paid per-tap or free + card verify) only applies to videos.
  const drain =
    mediaPath && mediaType === "video" ? parseBlurDrainer(blurDrainer) : null;

  const now = new Date().toISOString();
  const rows = targetIds.map((chat_id) => ({
    chat_id,
    sender: "owner" as const,
    content: content?.trim() || null,
    media_path: mediaPath || null,
    media_type: mediaType || null,
    locked: !!locked && !!mediaPath,
    created_at: now,
    ...(drain ? { blur_drainer: drain } : {}),
  }));

  const { data: inserted, error } = await db.from("messages").insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (let i = 0; i < targetIds.length; i += BATCH) {
    await db
      .from("chats")
      .update({ last_message_at: now, last_read_at: now })
      .in("id", targetIds.slice(i, i + BATCH));
  }

  // Push each new message to its chat, plus inbox refreshes for the sidebar.
  // Delivered after the response in bounded batches: firing thousands of
  // realtime calls at once would stall (or kill) the request.
  const origin = requestOrigin(req.headers);
  after(async () => {
    const jobs = (inserted ?? []).flatMap((m) => [
      () => broadcast(`chat:${m.chat_id}`, "new-message", m),
      () =>
        broadcast(`inbox:${ownerId}`, "new-message", {
          chatId: m.chat_id,
          content: m.content ?? null,
          media_type: m.media_type ?? null,
          created_at: m.created_at,
          sender: m.sender,
        }),
    ]);
    if (jobs.length === 0) {
      // Fallback ping if insert returned nothing unexpected.
      jobs.push(() =>
        broadcast(`inbox:${ownerId}`, "new-message", { chatId: targetIds[0] })
      );
    }
    for (let i = 0; i < jobs.length; i += BROADCAST_BATCH) {
      await Promise.all(jobs.slice(i, i + BROADCAST_BATCH).map((run) => run()));
    }

    // SMS-nudge every offline recipient (online guests and already-nudged
    // offline guests are skipped inside the helper).
    for (const id of targetIds) {
      await notifyGuestSms(id, origin);
    }
  });

  return NextResponse.json({ ok: true, sent: targetIds.length });
}
