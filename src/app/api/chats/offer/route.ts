import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { broadcast } from "@/lib/realtime";

/**
 * Creator sends a custom one-time offer to a specific fan. It's stored on
 * the chat and broadcast so the fan's popup appears immediately — presented
 * as a platform offer, never as a message from the creator.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId, tokens, priceCents, originalCents } = await req.json();
  const tokensNum = Math.round(Number(tokens));
  const priceNum = Math.round(Number(priceCents));
  const originalNum = Math.round(Number(originalCents));
  if (
    !chatId ||
    !(tokensNum > 0) ||
    !(priceNum > 0) ||
    !(originalNum > 0)
  ) {
    return NextResponse.json(
      { error: "chatId, tokens, priceCents and originalCents required" },
      { status: 400 }
    );
  }

  const offer = {
    id: crypto.randomUUID(),
    tokens: tokensNum,
    priceCents: priceNum,
    originalCents: originalNum,
    createdAt: new Date().toISOString(),
  };

  const { data: chat, error } = await supabaseAdmin()
    .from("chats")
    .update({ custom_offer: offer })
    .eq("id", chatId)
    .eq("owner_id", ownerId)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  // Fan sees the popup right away if they're in the chat.
  await broadcast(`chat:${chatId}`, "custom-offer", offer);

  return NextResponse.json({ ok: true, offer });
}
