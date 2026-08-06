import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { previewMediaType } from "@/lib/chatPreview";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { endStaleCpmSessions } from "@/lib/cpm";
import { cpmSessionLive } from "@/lib/cpmShared";

/**
 * Creator sidebar: Chat-per-minute fans only (purple + gold star in the UI).
 * Includes the live metering session (if any) so the list can show Active + $.
 */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Settle crashed tabs before we read "active" sessions for the list.
  await endStaleCpmSessions(ownerId).catch(() => {});

  const db = supabaseAdmin();
  const { data: chats, error } = await db
    .from("chats")
    .select(
      "id, guest_name, custom_name, last_message_at, last_read_at, stripe_payment_method_id, cpm"
    )
    .eq("owner_id", ownerId)
    .eq("cpm", true)
    .eq("pending", false)
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (error) {
    // Column missing until migration runs — return empty rather than 500.
    if (/cpm|column/i.test(error.message)) {
      return NextResponse.json({ chats: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (chats ?? []).map((c) => c.id as string);
  type Preview = {
    chat_id: string;
    content: string | null;
    media_type: string | null;
  };
  const previewById = new Map<string, Preview>();
  type SessionRow = {
    chat_id: string;
    started_at: string;
    last_active_at: string;
    minutes_charged: number;
  };
  const sessionById = new Map<string, SessionRow>();
  if (ids.length) {
    const [{ data: msgs }, { data: sessions }] = await Promise.all([
      db
        .from("messages")
        .select("chat_id, content, media_type, created_at")
        .in("chat_id", ids)
        .order("created_at", { ascending: false })
        .limit(ids.length * 3),
      db
        .from("cpm_sessions")
        .select("chat_id, started_at, last_active_at, minutes_charged")
        .eq("owner_id", ownerId)
        .eq("status", "active")
        .in("chat_id", ids),
    ]);
    for (const m of msgs ?? []) {
      const id = m.chat_id as string;
      if (previewById.has(id)) continue;
      previewById.set(id, {
        chat_id: id,
        content: (m.content as string | null) ?? null,
        media_type: previewMediaType(m),
      });
    }
    for (const s of sessions ?? []) {
      sessionById.set(s.chat_id as string, s as SessionRow);
    }
  }

  return NextResponse.json({
    chats: (chats ?? []).map((c) => {
      const preview = previewById.get(c.id as string);
      const unread =
        c.last_read_at && c.last_message_at
          ? new Date(c.last_message_at as string) >
            new Date(c.last_read_at as string)
            ? 1
            : 0
          : 0;
      const sess = sessionById.get(c.id as string);
      return {
        id: c.id,
        guest_name: c.guest_name,
        custom_name: c.custom_name,
        last_message_at: c.last_message_at,
        hasCard: !!c.stripe_payment_method_id,
        unread,
        preview: preview
          ? { content: preview.content, media_type: preview.media_type }
          : null,
        session: sess
          ? {
              startedAt: sess.started_at,
              lastActiveAt: sess.last_active_at,
              minutesCharged: sess.minutes_charged,
              live: cpmSessionLive(sess.last_active_at),
            }
          : null,
      };
    }),
  });
}

/**
 * Delete a Chat-per-minute fan completely: their Stripe customer (which
 * detaches and removes the saved card from Stripe), and their chat on
 * Lolyfans — messages, sessions and everything else cascade with it.
 */
export async function DELETE(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chatId = (req.nextUrl.searchParams.get("chatId") || "").trim();
  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: chat } = await db
    .from("chats")
    .select("id, owner_id, cpm, stripe_customer_id, guest_ip")
    .eq("id", chatId)
    .maybeSingle();
  if (!chat || chat.owner_id !== ownerId || !chat.cpm) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  // Close any running session first — no final charge: the fan's payment
  // profile is about to be erased entirely.
  await db
    .from("cpm_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("status", "active");

  // Erase the fan from Stripe: deleting the customer removes their saved
  // payment methods and personal details there.
  if (chat.stripe_customer_id && stripeConfigured()) {
    await stripe()
      .customers.del(chat.stripe_customer_id as string)
      .catch(() => {
        // Already deleted / not found — the chat still goes.
      });
  }

  // Delete the chat — messages, cpm_sessions, unlocks etc. cascade in the DB.
  const { error } = await db.from("chats").delete().eq("id", chatId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
