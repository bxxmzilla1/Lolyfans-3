import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { mediaItemsFromMessage } from "@/lib/utils";
import { payPerMessageFromMetadata } from "@/lib/payPerMessage";
import { ensurePpmCredit } from "@/lib/payments";

/**
 * Live fan state for the creator's open chat. Polled while the tab is
 * visible: card-on-file, free credit remaining, plus accept/decline/unlock
 * status for each creator photo/video.
 */
export async function GET(req: NextRequest) {
  try {
    const ownerId = await getOwnerId();
    if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const chatId = req.nextUrl.searchParams.get("chatId");
    if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

    const db = supabaseAdmin();
    const { data: chat, error: chatErr } = await db
      .from("chats")
      .select(
        "stripe_payment_method_id, ppm_accepted_at, ppm_messages_used, ppm_credit_cents, ppm_credit_granted, ppm_balance_cents, paidsub_offer_at, paidsub_paid_at"
      )
      .eq("id", chatId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (chatErr) {
      return NextResponse.json({ error: chatErr.message }, { status: 500 });
    }
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    const { data: ownerUser } = await db.auth.admin.getUserById(ownerId);
    const ppm = payPerMessageFromMetadata(ownerUser?.user?.user_metadata ?? {});

    let creditCents = 0;
    if (ppm.enabled) {
      if (chat.ppm_accepted_at || chat.ppm_credit_granted) {
        // Heal legacy / missing grants so the header shows real money left.
        const granted = await ensurePpmCredit({
          chatId,
          freeCreditCents: ppm.freeCreditCents,
          priceCents: ppm.priceCents,
          chat,
        });
        creditCents = granted.creditCents;
      } else {
        // Fan hasn't started yet — show the free credit they will receive.
        creditCents = ppm.freeCreditCents;
      }
    }

    // Recent owner media only — enough for the open thread, cheap to poll.
    const { data: rows, error: rowsErr } = await db
      .from("messages")
      .select("id, fan_decision, media_path, media_type, media_items")
      .eq("chat_id", chatId)
      .eq("sender", "owner")
      .order("created_at", { ascending: false })
      .limit(80);
    if (rowsErr) {
      return NextResponse.json({ error: rowsErr.message }, { status: 500 });
    }

    const mediaRows = (rows ?? []).filter((m) =>
      mediaItemsFromMessage(m).some((i) => i.type === "image" || i.type === "video")
    );
    const ids = mediaRows.map((m) => m.id as string);
    const unlocked = new Set<string>();
    const drainCleared = new Map<string, number>();
    if (ids.length) {
      const [{ data: unlocks }, { data: drains }] = await Promise.all([
        db
          .from("message_unlocks")
          .select("message_id")
          .eq("chat_id", chatId)
          .in("message_id", ids),
        db
          .from("message_blur_progress")
          .select("message_id, layers_cleared")
          .eq("chat_id", chatId)
          .in("message_id", ids),
      ]);
      for (const u of unlocks ?? []) unlocked.add(u.message_id as string);
      for (const d of drains ?? []) {
        drainCleared.set(d.message_id as string, d.layers_cleared as number);
      }
    }

    const media = mediaRows.map((m) => ({
      id: m.id as string,
      fan_decision: (m.fan_decision as "accepted" | "rejected" | null) ?? null,
      unlocked: unlocked.has(m.id as string),
      blur_layers_cleared: drainCleared.get(m.id as string) ?? 0,
    }));

    return NextResponse.json({
      hasCard: !!chat.stripe_payment_method_id,
      // Orange clock in the header while the PaidSub offer awaits payment.
      paidSubPending: !!chat.paidsub_offer_at && !chat.paidsub_paid_at,
      ppmAccepted: !!chat.ppm_accepted_at,
      ppmEnabled: ppm.enabled,
      ppmFreeCreditCents: ppm.enabled ? ppm.freeCreditCents : 0,
      ppmCreditCents: creditCents,
      media,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fan state failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
