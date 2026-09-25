import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guestOwnsChat } from "@/lib/guestAuth";
import { recordBlurDrainTap, spendTokens, tokenBalance } from "@/lib/payments";
import { parseBlurDrainer } from "@/lib/blurDrainer";
import { tokensForCents } from "@/lib/tokens";

/** GET: current progress for this fan + message. */
export async function GET(req: NextRequest) {
  const messageId = req.nextUrl.searchParams.get("messageId");
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: message } = await db
    .from("messages")
    .select("id, chat_id, blur_drainer")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await guestOwnsChat(req.headers, message.chat_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfg = parseBlurDrainer(message.blur_drainer);
  if (!cfg) return NextResponse.json({ error: "Not a BlurDrainer message" }, { status: 400 });

  const { data: prog } = await db
    .from("message_blur_progress")
    .select("layers_cleared")
    .eq("message_id", messageId)
    .eq("chat_id", message.chat_id)
    .maybeSingle();

  return NextResponse.json({
    config: cfg,
    layersCleared: prog?.layers_cleared ?? 0,
  });
}

/**
 * POST: unblur one BlurDrainer layer. Paid drains spend Tokens from the
 * fan's wallet; an empty wallet returns 402 so the client opens the Phantom
 * top-up sheet. Free drains cost nothing.
 */
export async function POST(req: NextRequest) {
  const { messageId } = await req.json();
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: message } = await db
    .from("messages")
    .select("id, chat_id, blur_drainer")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await guestOwnsChat(req.headers, message.chat_id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfg = parseBlurDrainer(message.blur_drainer);
  if (!cfg) return NextResponse.json({ error: "Not a BlurDrainer message" }, { status: 400 });

  const { data: prog } = await db
    .from("message_blur_progress")
    .select("layers_cleared")
    .eq("message_id", messageId)
    .eq("chat_id", message.chat_id)
    .maybeSingle();
  const cleared = prog?.layers_cleared ?? 0;

  if (cleared >= cfg.layers) {
    return NextResponse.json({ ok: true, layersCleared: cleared, done: true });
  }

  if (cfg.priceCents <= 0) {
    const layersCleared = await recordBlurDrainTap({
      messageId: message.id,
      chatId: message.chat_id,
      layers: cfg.layers,
      paymentIntentId: `free_${message.id}_${cleared + 1}`,
    });
    return NextResponse.json({
      ok: true,
      layersCleared,
      done: layersCleared >= cfg.layers,
    });
  }

  // Paid drain: one tap = one instant token spend from the wallet.
  const tokens = tokensForCents(cfg.priceCents);
  const balance = await spendTokens({
    chatId: message.chat_id,
    tokens,
    kind: "unlock",
    messageId: message.id,
  });
  if (balance === null) {
    return NextResponse.json(
      {
        error: "Not enough Tokens",
        needTokens: tokens,
        balance: await tokenBalance(message.chat_id),
      },
      { status: 402 }
    );
  }
  const layersCleared = await recordBlurDrainTap({
    messageId: message.id,
    chatId: message.chat_id,
    layers: cfg.layers,
    paymentIntentId: `tokens_${message.id}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  });

  return NextResponse.json({
    ok: true,
    layersCleared,
    balance,
    done: layersCleared >= cfg.layers,
  });
}
