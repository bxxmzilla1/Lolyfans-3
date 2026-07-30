import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { broadcast } from "@/lib/realtime";
import { notifyGuestSms, requestOrigin } from "@/lib/smsNotify";
import { parseBlurDrainer } from "@/lib/blurDrainer";

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
  // Only keep chats this owner owns
  const { data: owned } = await db
    .from("chats")
    .select("id")
    .eq("owner_id", ownerId)
    .in("id", chatIds);
  const targetIds = (owned ?? []).map((c) => c.id);
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

  await db
    .from("chats")
    .update({ last_message_at: now, last_read_at: now })
    .in("id", targetIds);

  // Push each new message to its chat, plus inbox refreshes for the sidebar.
  const sample = inserted?.[0];
  await Promise.all([
    ...(inserted ?? []).map((m) => broadcast(`chat:${m.chat_id}`, "new-message", m)),
    ...(inserted ?? []).map((m) =>
      broadcast(`inbox:${ownerId}`, "new-message", {
        chatId: m.chat_id,
        content: m.content ?? null,
        media_type: m.media_type ?? null,
        created_at: m.created_at,
        sender: m.sender,
      })
    ),
    // Keep a single fallback ping if insert returned nothing unexpected.
    ...(sample
      ? []
      : [broadcast(`inbox:${ownerId}`, "new-message", { chatId: targetIds[0] })]),
  ]);

  // SMS-nudge every offline recipient (after the response; online guests and
  // already-nudged offline guests are skipped inside the helper).
  const origin = requestOrigin(req.headers);
  after(async () => {
    for (const id of targetIds) {
      await notifyGuestSms(id, origin);
    }
  });

  return NextResponse.json({ ok: true, sent: targetIds.length });
}
