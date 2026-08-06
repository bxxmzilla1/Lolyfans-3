import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { previewMediaType } from "@/lib/chatPreview";
import { stripe, stripeConfigured } from "@/lib/stripe";

/**
 * Creator sidebar: Chat-per-minute fans only (purple + gold star in the UI).
 */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  type ChatRow = {
    id: string;
    guest_name: string;
    custom_name: string | null;
    last_message_at: string;
    last_read_at: string | null;
    stripe_payment_method_id: string | null;
    cpm: boolean;
    tg_peer?: string | null;
  };
  const baseSelect =
    "id, guest_name, custom_name, last_message_at, last_read_at, stripe_payment_method_id, cpm";
  let chats: ChatRow[] | null = null;
  let error: { message: string } | null = null;
  {
    const first = await db
      .from("chats")
      .select(`${baseSelect}, tg_peer`)
      .eq("owner_id", ownerId)
      .eq("cpm", true)
      .eq("pending", false)
      .order("last_message_at", { ascending: false })
      .limit(100);
    chats = (first.data as ChatRow[] | null) ?? null;
    error = first.error;
  }

  // tg_peer column missing (migration not run) — load without it.
  if (error && /tg_peer/i.test(error.message)) {
    const second = await db
      .from("chats")
      .select(baseSelect)
      .eq("owner_id", ownerId)
      .eq("cpm", true)
      .eq("pending", false)
      .order("last_message_at", { ascending: false })
      .limit(100);
    chats = (second.data as ChatRow[] | null) ?? null;
    error = second.error;
  }

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
  if (ids.length) {
    const { data: msgs } = await db
      .from("messages")
      .select("chat_id, content, media_type, created_at")
      .in("chat_id", ids)
      .order("created_at", { ascending: false })
      .limit(ids.length * 3);
    for (const m of msgs ?? []) {
      const id = m.chat_id as string;
      if (previewById.has(id)) continue;
      previewById.set(id, {
        chat_id: id,
        content: (m.content as string | null) ?? null,
        media_type: previewMediaType(m),
      });
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
      return {
        id: c.id,
        guest_name: c.guest_name,
        custom_name: c.custom_name,
        last_message_at: c.last_message_at,
        hasCard: !!c.stripe_payment_method_id,
        tgPeer: c.tg_peer ?? null,
        unread,
        preview: preview
          ? { content: preview.content, media_type: preview.media_type }
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
