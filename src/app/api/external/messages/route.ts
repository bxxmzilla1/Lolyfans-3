import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ownerFromApiKey } from "@/lib/apiKey";
import { broadcast } from "@/lib/realtime";
import { notifyGuestSms, requestOrigin } from "@/lib/smsNotify";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * External send API for connected apps (Orion): post a reply into a chat as
 * the owner. Marks the chat as bot-replied so auto-respond won't answer the
 * same fan message twice. Auth is the owner's API key.
 *
 * Supports media packages: `mediaItems: [{ path, type }, ...]` plus an
 * optional `priceCents` — a positive price sends it locked (pay-to-unlock
 * with tokens), mirroring the owner inbox composer.
 */
export async function POST(req: NextRequest) {
  const ownerId = await ownerFromApiKey(req);
  if (!ownerId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401, headers: CORS });
  }

  const body = await req.json();
  const { chatId, content, mediaPath, mediaType, locked, notify, priceCents } = body;

  // Normalize single mediaPath (legacy) or mediaItems (packages).
  const mediaItems: { path: string; type: "image" | "video" }[] = [];
  if (Array.isArray(body.mediaItems)) {
    for (const it of body.mediaItems) {
      if (it && typeof it.path === "string" && it.path) {
        mediaItems.push({ path: it.path, type: it.type === "video" ? "video" : "image" });
      }
    }
  }
  if (mediaItems.length === 0 && typeof mediaPath === "string" && mediaPath) {
    mediaItems.push({ path: mediaPath, type: mediaType === "video" ? "video" : "image" });
  }

  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400, headers: CORS });
  }
  if (!content?.trim() && mediaItems.length === 0) {
    return NextResponse.json({ error: "Empty message" }, { status: 400, headers: CORS });
  }

  const db = supabaseAdmin();
  // Only allow sending into a chat this owner actually owns.
  const { data: chat } = await db
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404, headers: CORS });
  }

  const price =
    mediaItems.length > 0 && Number.isFinite(Number(priceCents))
      ? Math.max(0, Math.round(Number(priceCents)))
      : 0;

  const { data: message, error } = await db
    .from("messages")
    .insert({
      chat_id: chatId,
      sender: "owner",
      content: content?.trim() || null,
      media_path: mediaItems[0]?.path ?? null,
      media_type: mediaItems[0]?.type ?? null,
      media_items: mediaItems,
      // A positive price implies locked; `locked` alone still works (manual blur).
      locked: (!!locked || price > 0) && mediaItems.length > 0,
      price_cents: price,
    })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: CORS });
  }

  const now = message.created_at;
  await Promise.all([
    db
      .from("chats")
      .update({ last_message_at: now, last_read_at: now, bot_replied_at: now })
      .eq("id", chatId),
    broadcast(`chat:${chatId}`, "new-message", message),
    broadcast(`inbox:${ownerId}`, "new-message", { chatId }),
  ]);

  // Offline guest? Nudge them by SMS. Orion sends `notify: false` on every
  // bubble except its last one, so the text goes out exactly once, after the
  // reply is complete.
  if (notify !== false) {
    const origin = requestOrigin(req.headers);
    after(() => notifyGuestSms(chatId, origin));
  }

  return NextResponse.json({ message }, { headers: CORS });
}
