import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  botForOwner,
  botSendPpvBubble,
  DEFAULT_PPV_LINK_TEXT,
  getPpvLinkText,
  parseWebAppUser,
  savePpvLinkText,
  verifyWebAppInitData,
} from "@/lib/telegramBot";

/** Saved pay-link text — prefills the input in the vault Mini App. */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    linkText: await getPpvLinkText(ownerId),
    defaultText: DEFAULT_PPV_LINK_TEXT,
  });
}

/**
 * Vault Mini App → PPV: the signed-in creator picks a vault item and a
 * Stars price; the bot drops the blurred forwardable bubble into their own
 * bot chat (Telegram identity comes from the verified initData).
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bot = await botForOwner(ownerId);
  if (!bot) {
    return NextResponse.json(
      { error: "Connect a Telegram bot in Settings first" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const initData = String(body.initData || "");
  const mediaPath = String(body.mediaPath || "").trim();
  const mediaType = body.mediaType === "video" ? "video" : "image";
  const priceStars = Math.round(Number(body.priceStars) || 0);
  const caption = String(body.caption || "").trim().slice(0, 300);
  const linkText = String(body.linkText || "").trim().slice(0, 120);

  if (!mediaPath) {
    return NextResponse.json({ error: "Pick a vault item" }, { status: 400 });
  }
  if (priceStars < 1) {
    return NextResponse.json({ error: "Minimum is 1 Star" }, { status: 400 });
  }

  // The initData is signed by this owner's bot — proves which Telegram chat
  // the bubble should land in (the creator's own chat with their bot).
  const verified = verifyWebAppInitData(initData, bot.bot_token);
  const tgUser = verified ? parseWebAppUser(verified) : null;
  if (!tgUser) {
    return NextResponse.json(
      { error: "Open this page from your bot's Vault button in Telegram" },
      { status: 401 }
    );
  }

  // The vault item must belong to the signed-in creator. (limit(1), not
  // maybeSingle — the same file registered twice must not error out.)
  const db = supabaseAdmin();
  const { data: items } = await db
    .from("vault_items")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("media_path", mediaPath)
    .limit(1);
  if (!items?.length) {
    return NextResponse.json({ error: "Not in your vault" }, { status: 404 });
  }

  const { data: unlock, error } = await db
    .from("stars_unlocks")
    .insert({
      owner_id: ownerId,
      creator_tg_id: tgUser.id,
      media_path: mediaPath,
      media_type: mediaType,
      caption: caption || null,
      price_stars: priceStars,
      status: "pending",
    })
    .select("*")
    .single();
  if (error || !unlock) {
    return NextResponse.json(
      { error: error?.message || "Could not create the PPV" },
      { status: 500 }
    );
  }

  // Remember the custom pay-link text for future PPVs (DM flow included).
  if (linkText) {
    await savePpvLinkText(ownerId, linkText).catch(() => {});
  }

  try {
    await botSendPpvBubble({
      token: bot.bot_token,
      chatId: tgUser.id,
      unlockId: unlock.id,
      mediaType,
      mediaPath,
      caption: caption || null,
      stars: priceStars,
      linkText: linkText || (await getPpvLinkText(ownerId)),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not send the PPV" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
