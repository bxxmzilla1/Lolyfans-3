import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId, getGuestChatId } from "@/lib/session";
import { broadcast } from "@/lib/realtime";
import { notifyGuestSms, requestOrigin } from "@/lib/smsNotify";
import { guestAccessDestination } from "@/lib/subscriptionAccess";
import { parseBlurDrainer } from "@/lib/blurDrainer";
import { payPerMessageFromMetadata } from "@/lib/payPerMessage";
import { settlePpmBalance } from "@/lib/payments";

type ChatAuth = { role: "owner" | "guest"; chatOwnerId: string };

/** A user may access a chat if they own it (signed in) or joined it as a guest. */
async function authorizeChat(chatId: string): Promise<ChatAuth | null> {
  const { data: chat } = await supabaseAdmin()
    .from("chats")
    .select("owner_id")
    .eq("id", chatId)
    .single();
  if (!chat) return null;

  const guestChatId = await getGuestChatId();
  if (guestChatId && guestChatId === chatId) {
    return { role: "guest", chatOwnerId: chat.owner_id };
  }

  const ownerId = await getOwnerId();
  if (ownerId && ownerId === chat.owner_id) {
    return { role: "owner", chatOwnerId: chat.owner_id };
  }
  return null;
}

export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get("chatId");
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  // Run the auth check and the query in parallel; data is only returned if authorized.
  // Newest 500 first, flipped back to chronological — ascending+limit would
  // freeze the view at the oldest 500 once a chat grows past that.
  const [auth, { data, error }] = await Promise.all([
    authorizeChat(chatId),
    supabaseAdmin()
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  data?.reverse();

  if (auth.role === "guest") {
    const access = await guestAccessDestination(chatId, auth.chatOwnerId);
    if (!access.allowed) {
      return NextResponse.json(
        { error: "Subscribe to this profile to view messages", paywall: access.href },
        { status: 402 }
      );
    }
  }

  if (auth.role === "owner") {
    await supabaseAdmin()
      .from("chats")
      .update({ last_read_at: new Date().toISOString() })
      .eq("id", chatId);
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hidden messages are only visible to the owner. Both sides get an
  // `unlocked` flag per priced-locked message: paid ones reveal for the fan
  // and show as paid (green bubble) for the creator.
  let messages = data ?? [];
  if (auth.role === "guest") {
    // Rejected media (the fan declined it at the incoming-media gate) is
    // gone for them for good.
    messages = messages.filter((m) => !m.hidden && m.fan_decision !== "rejected");
  }
  // Blur progress goes to both sides: fans resume where they left off, the
  // creator sees how many layers were tapped (green bubble).
  const [{ data: unlocks }, { data: drains }] = await Promise.all([
    supabaseAdmin()
      .from("message_unlocks")
      .select("message_id")
      .eq("chat_id", chatId),
    supabaseAdmin()
      .from("message_blur_progress")
      .select("message_id, layers_cleared")
      .eq("chat_id", chatId),
  ]);
  const unlockedIds = new Set((unlocks ?? []).map((u) => u.message_id));
  const drainMap = new Map(
    (drains ?? []).map((d) => [d.message_id as string, d.layers_cleared as number])
  );
  messages = messages.map((m) => ({
    ...m,
    unlocked: unlockedIds.has(m.id),
    ...(drainMap.has(m.id) ? { blur_layers_cleared: drainMap.get(m.id) } : {}),
  }));
  return NextResponse.json({ messages, role: auth.role });
}

function normalizeMediaItems(body: {
  mediaItems?: unknown;
  mediaPath?: unknown;
  mediaType?: unknown;
}): { path: string; type: "image" | "video" | "audio" }[] {
  const items: { path: string; type: "image" | "video" | "audio" }[] = [];
  if (Array.isArray(body.mediaItems)) {
    for (const entry of body.mediaItems) {
      if (!entry || typeof entry !== "object") continue;
      const path = (entry as { path?: unknown }).path;
      const type = (entry as { type?: unknown }).type;
      if (typeof path !== "string" || !path) continue;
      if (type !== "image" && type !== "video" && type !== "audio") continue;
      items.push({ path, type });
      if (items.length >= 12) break;
    }
  }
  if (items.length === 0 && typeof body.mediaPath === "string" && body.mediaPath) {
    const type =
      body.mediaType === "video" ? "video" : body.mediaType === "audio" ? "audio" : "image";
    items.push({ path: body.mediaPath, type });
  }
  return items;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { chatId, content, replyToId, locked, priceCents, decideSeconds, blurDrainer } =
    body;
  const mediaItems = normalizeMediaItems(body);
  const mediaPath = mediaItems[0]?.path ?? null;
  const mediaType = mediaItems[0]?.type ?? null;
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });
  if (!content?.trim() && mediaItems.length === 0) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const auth = await authorizeChat(chatId);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Paid profiles: guests can't message until they've subscribed.
  if (auth.role === "guest") {
    const access = await guestAccessDestination(chatId, auth.chatOwnerId);
    if (!access.allowed) {
      return NextResponse.json(
        { error: "Subscribe to this profile to send messages", paywall: access.href },
        { status: 402 }
      );
    }
  }

  const db = supabaseAdmin();

  // Pay per Message: spend free credit first; after that each message adds
  // its price to the owed balance (auto-charged hourly). Terms must be
  // accepted, and billing requires a working card on file.
  if (auth.role === "guest") {
    const { data: ownerUser } = await db.auth.admin.getUserById(auth.chatOwnerId);
    const ppm = payPerMessageFromMetadata(ownerUser?.user?.user_metadata ?? {});
    if (ppm.enabled) {
      const { data: chatRow } = await db
        .from("chats")
        .select(
          "ppm_accepted_at, ppm_messages_used, ppm_balance_cents, ppm_credit_cents, ppm_credit_granted, ppm_card_declined, stripe_payment_method_id"
        )
        .eq("id", chatId)
        .maybeSingle();
      if (!chatRow?.ppm_accepted_at) {
        return NextResponse.json(
          { error: "Accept the chat terms to start messaging", ppm: "accept" },
          { status: 402 }
        );
      }
      let credit = chatRow.ppm_credit_cents ?? 0;
      // One-time heal for fans who accepted under the old free-messages model.
      if (!chatRow.ppm_credit_granted) {
        const usedCost = (chatRow.ppm_messages_used ?? 0) * ppm.priceCents;
        credit = Math.max(0, ppm.freeCreditCents - usedCost);
        await db
          .from("chats")
          .update({ ppm_credit_cents: credit, ppm_credit_granted: true })
          .eq("id", chatId);
      }
      const price = ppm.priceCents;
      const fromCredit = Math.min(credit, price);
      const billable = price - fromCredit;
      if (billable > 0 && !chatRow.stripe_payment_method_id) {
        return NextResponse.json(
          { error: "Add your card to keep chatting", ppm: "card" },
          { status: 402 }
        );
      }
      if (billable > 0 && chatRow.ppm_card_declined) {
        return NextResponse.json(
          { error: "Payment failed. Please add another payment detail", ppm: "declined" },
          { status: 402 }
        );
      }
      await db
        .from("chats")
        .update({
          ppm_messages_used: (chatRow.ppm_messages_used ?? 0) + 1,
          ppm_credit_cents: credit - fromCredit,
          ...(billable > 0
            ? { ppm_balance_cents: (chatRow.ppm_balance_cents ?? 0) + billable }
            : {}),
        })
        .eq("id", chatId);
      if (billable > 0) after(() => settlePpmBalance(chatId));
    }
  }

  // Optional decision countdown for the incoming-media gate (owner-set, only
  // meaningful on photos/videos). Clamped to 1 hour; 0 = no time limit. The
  // key is only included when set, so sends keep working pre-migration.
  const hasVisualMedia = mediaItems.some((i) => i.type === "image" || i.type === "video");
  const hasVideo = mediaItems.some((i) => i.type === "video");
  const decide =
    auth.role === "owner" && hasVisualMedia
      ? Math.max(0, Math.min(3600, Math.round(Number(decideSeconds)) || 0))
      : 0;
  // BlurDrainer only on owner-sent videos.
  const drain =
    auth.role === "owner" && hasVideo ? parseBlurDrainer(blurDrainer) : null;

  const { data: message, error } = await db
    .from("messages")
    .insert({
      chat_id: chatId,
      sender: auth.role,
      content: content?.trim() || null,
      media_path: mediaPath,
      media_type: mediaType,
      media_items: mediaItems,
      reply_to_id: replyToId || null,
      locked: !!locked && mediaItems.length > 0,
      // Only the owner can price media; a positive price makes it pay-to-unlock.
      price_cents:
        auth.role === "owner" && mediaItems.length > 0 && Number.isFinite(priceCents)
          ? Math.max(0, Math.round(Number(priceCents)))
          : 0,
      ...(decide > 0 ? { decide_seconds: decide } : {}),
      ...(drain ? { blur_drainer: drain } : {}),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const chatUpdate: Record<string, string> = { last_message_at: message.created_at };
  if (auth.role === "owner") chatUpdate.last_read_at = message.created_at;

  await Promise.all([
    db.from("chats").update(chatUpdate).eq("id", chatId),
    broadcast(`chat:${chatId}`, "new-message", message),
    // Owner's chat list updates instantly on any new message.
    broadcast(`inbox:${auth.chatOwnerId}`, "new-message", {
      chatId,
      content: message.content ?? null,
      media_type: message.media_type ?? null,
      created_at: message.created_at,
      sender: message.sender,
    }),
  ]);

  // Offline guest? Nudge them by SMS (after the response, never blocking).
  if (auth.role === "owner") {
    const origin = requestOrigin(req.headers);
    after(() => notifyGuestSms(chatId, origin));
  }

  return NextResponse.json({ message });
}

/** Toggle the blur lock on a media message. Only the sender may do this. */
export async function PATCH(req: NextRequest) {
  const { messageId, locked } = await req.json();
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("messages")
    .select("id, chat_id, sender, media_path, media_items")
    .eq("id", messageId)
    .single();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const auth = await authorizeChat(existing.chat_id);
  if (!auth || auth.role !== existing.sender) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const hasMedia =
    !!existing.media_path ||
    (Array.isArray(existing.media_items) && existing.media_items.length > 0);
  if (!hasMedia) {
    return NextResponse.json({ error: "Only media messages can be locked" }, { status: 400 });
  }

  const { data: message, error } = await db
    .from("messages")
    .update({ locked: !!locked })
    .eq("id", messageId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcast(`chat:${existing.chat_id}`, "update-message", message);
  return NextResponse.json({ message });
}
