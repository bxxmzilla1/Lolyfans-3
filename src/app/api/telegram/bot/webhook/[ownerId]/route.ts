import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  BOT_ACTIVATION_CODE,
  botApi,
  botForOwner,
  botGetFileUrl,
  botSendByFileId,
  botSendMedia,
  botSendPpvBubble,
  botSendText,
  escHtml,
} from "@/lib/telegramBot";
import { mediaUrl } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

type TgUser = {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: TgUser;
    chat: { id: number; type: string };
    text?: string;
    caption?: string;
    photo?: { file_id: string; file_size?: number }[];
    video?: { file_id: string; file_size?: number; mime_type?: string };
    successful_payment?: {
      currency: string;
      total_amount: number;
      invoice_payload: string;
      telegram_payment_charge_id: string;
    };
  };
  pre_checkout_query?: {
    id: string;
    from: TgUser;
    currency: string;
    total_amount: number;
    invoice_payload: string;
  };
};

/**
 * PPV-maker bot webhook. The creator DMs the bot:
 *   1. First use: bot asks for the private activation code.
 *   2. Send a photo/video (+ optional caption) → bot asks the Stars price
 *      (or reads it from a numeric caption) and replies with a forwardable
 *      Stars invoice.
 *   3. Creator forwards the invoice to any fan. When the fan pays, the bot
 *      sends the creator the unlocked media plus who to forward it to.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ownerId: string }> }
) {
  const { ownerId } = await params;
  const secret = req.nextUrl.searchParams.get("secret") || "";
  const bot = await botForOwner(ownerId);
  if (!bot || !secret || secret !== bot.webhook_secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update) return NextResponse.json({ ok: true });

  try {
    if (update.pre_checkout_query) {
      await handlePreCheckout(bot.bot_token, update.pre_checkout_query);
    } else if (update.message?.successful_payment) {
      await handleSuccessfulPayment(
        ownerId,
        bot.bot_token,
        update.message.from!,
        update.message.successful_payment
      );
    } else if (
      update.message?.from &&
      !update.message.from.is_bot &&
      update.message.chat.type === "private"
    ) {
      await handlePrivateMessage(ownerId, bot.bot_token, update.message);
    }
  } catch (e) {
    console.error("[bot webhook]", e);
  }

  return NextResponse.json({ ok: true });
}

async function handlePreCheckout(
  token: string,
  q: NonNullable<TgUpdate["pre_checkout_query"]>
) {
  const unlockId = q.invoice_payload;
  const { data: unlock } = await supabaseAdmin()
    .from("stars_unlocks")
    .select("id, status, price_stars")
    .eq("id", unlockId)
    .maybeSingle();

  if (!unlock || unlock.status !== "pending") {
    await botApi(token, "answerPreCheckoutQuery", {
      pre_checkout_query_id: q.id,
      ok: false,
      error_message: "This unlock is no longer available.",
    });
    return;
  }
  if (q.currency !== "XTR" || q.total_amount !== unlock.price_stars) {
    await botApi(token, "answerPreCheckoutQuery", {
      pre_checkout_query_id: q.id,
      ok: false,
      error_message: "Price mismatch. Please try again.",
    });
    return;
  }
  await botApi(token, "answerPreCheckoutQuery", {
    pre_checkout_query_id: q.id,
    ok: true,
  });
}

/** After payment: hand the creator the unlocked media + who paid. */
async function handleSuccessfulPayment(
  ownerId: string,
  token: string,
  payer: TgUser,
  payment: NonNullable<NonNullable<TgUpdate["message"]>["successful_payment"]>
) {
  const unlockId = payment.invoice_payload;
  const db = supabaseAdmin();
  const { data: unlock } = await db
    .from("stars_unlocks")
    .select("*")
    .eq("id", unlockId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!unlock || unlock.status !== "pending") return;

  await db
    .from("stars_unlocks")
    .update({
      status: "paid",
      telegram_payment_charge_id: payment.telegram_payment_charge_id,
      paid_at: new Date().toISOString(),
    })
    .eq("id", unlockId)
    .eq("status", "pending");

  const creatorTgId = Number(unlock.creator_tg_id);
  if (!creatorTgId) return;

  // 1) The unlocked media itself — the creator forwards this bubble.
  try {
    if (unlock.tg_file_id) {
      await botSendByFileId({
        token,
        chatId: creatorTgId,
        fileId: unlock.tg_file_id,
        mediaType: unlock.media_type === "video" ? "video" : "image",
        caption: unlock.caption || undefined,
      });
    } else if (unlock.media_path) {
      await botSendMedia({
        token,
        chatId: creatorTgId,
        mediaPath: unlock.media_path,
        mediaType: unlock.media_type === "video" ? "video" : "image",
        caption: unlock.caption || undefined,
      });
    }
  } catch (e) {
    // Telegram refuses big URL uploads (~20MB) — hand over a direct link
    // instead so the creator can still grab and forward the file.
    console.error("[ppv deliver to creator]", e);
    if (unlock.media_path) {
      await botSendText(
        token,
        creatorTgId,
        `The file is too big for Telegram to attach — <a href="${mediaUrl(unlock.media_path)}">download the unlocked ${unlock.media_type === "video" ? "video" : "photo"} here</a>.`
      ).catch(() => {});
    }
  }

  // 2) Who paid — so the creator knows exactly who to forward it to.
  const payerName = [payer.first_name, payer.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const mention = payer.username
    ? `@${escHtml(payer.username)}`
    : `<a href="tg://user?id=${payer.id}">${escHtml(payerName || "this user")}</a>`;
  await botSendText(
    token,
    creatorTgId,
    `💰 <b>${escHtml(payerName || "Someone")}</b> (${mention}) just paid <b>${unlock.price_stars} Stars</b> for this PPV.\n\n☝️ Forward the unlocked media above to them.`
  ).catch((e) => console.error("[ppv payer notice]", e));

  await db
    .from("stars_unlocks")
    .update({ status: "delivered", delivered_at: new Date().toISOString() })
    .eq("id", unlockId);
}

type Operator = {
  owner_id: string;
  tg_user_id: number;
  pending_unlock_id: string | null;
};

async function handlePrivateMessage(
  ownerId: string,
  token: string,
  message: NonNullable<TgUpdate["message"]>
) {
  const from = message.from!;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const db = supabaseAdmin();

  const { data: operator } = await db
    .from("bot_operators")
    .select("owner_id, tg_user_id, pending_unlock_id")
    .eq("owner_id", ownerId)
    .eq("tg_user_id", from.id)
    .maybeSingle();

  // ---- Not activated yet: only the private code gets you in. ----
  if (!operator) {
    if (text === BOT_ACTIVATION_CODE) {
      await db.from("bot_operators").upsert(
        {
          owner_id: ownerId,
          tg_user_id: from.id,
          username: from.username ?? null,
          first_name: from.first_name ?? null,
        },
        { onConflict: "owner_id,tg_user_id" }
      );
      await botSendText(
        token,
        chatId,
        "✅ Activated.\n\nSend me a photo or video and I'll turn it into a Stars PPV you can forward to anyone. Tip: put the price in the caption (e.g. <b>50</b>) to skip a step."
      );
    } else {
      await botSendText(
        token,
        chatId,
        "🔒 This bot is private. Send the activation code to continue."
      );
    }
    return;
  }

  // ---- Activated: media → new PPV ----
  const media = pickMedia(message);
  if (media) {
    await createPpvDraft({
      db,
      token,
      ownerId,
      operator: operator as Operator,
      chatId,
      creatorTgId: from.id,
      media,
      caption: (message.caption || "").trim(),
    });
    return;
  }

  // ---- Activated: number while a draft waits for its price ----
  const price = parsePrice(text);
  if (operator.pending_unlock_id && price) {
    const { data: unlock } = await db
      .from("stars_unlocks")
      .select("*")
      .eq("id", operator.pending_unlock_id)
      .eq("owner_id", ownerId)
      .maybeSingle();
    await db
      .from("bot_operators")
      .update({ pending_unlock_id: null })
      .eq("owner_id", ownerId)
      .eq("tg_user_id", from.id);
    if (!unlock || unlock.status !== "draft") {
      await botSendText(
        token,
        chatId,
        "That PPV is gone — send the photo or video again."
      );
      return;
    }
    await finalizePpv({ db, token, chatId, unlock, price });
    return;
  }

  // ---- Anything else: short help ----
  await botSendText(
    token,
    chatId,
    operator.pending_unlock_id
      ? "Reply with the price in Stars for the media you just sent (e.g. <b>50</b>)."
      : "Send me a photo or video and I'll turn it into a Stars PPV you can forward. Put the price in the caption (e.g. <b>50</b>) to skip a step."
  );
}

function pickMedia(message: NonNullable<TgUpdate["message"]>): {
  fileId: string;
  mediaType: "image" | "video";
} | null {
  if (message.video?.file_id) {
    return { fileId: message.video.file_id, mediaType: "video" };
  }
  const photo = message.photo?.[message.photo.length - 1];
  if (photo?.file_id) {
    return { fileId: photo.file_id, mediaType: "image" };
  }
  return null;
}

function parsePrice(text: string): number | null {
  if (!/^\d{1,6}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 ? n : null;
}

async function createPpvDraft(opts: {
  db: ReturnType<typeof supabaseAdmin>;
  token: string;
  ownerId: string;
  operator: Operator;
  chatId: number;
  creatorTgId: number;
  media: { fileId: string; mediaType: "image" | "video" };
  caption: string;
}) {
  const { db, token, ownerId, chatId, media } = opts;

  // Caption that's just a number is the price, not a caption.
  const priceFromCaption = parsePrice(opts.caption);
  const caption = priceFromCaption ? "" : opts.caption;

  const { data: unlock, error } = await db
    .from("stars_unlocks")
    .insert({
      owner_id: ownerId,
      creator_tg_id: opts.creatorTgId,
      tg_file_id: media.fileId,
      media_type: media.mediaType,
      caption: caption || null,
      price_stars: 0,
      status: "draft",
    })
    .select("*")
    .single();
  if (error || !unlock) {
    await botSendText(token, chatId, "Something went wrong — try again.");
    return;
  }

  // Copy the file into storage so the invoice can show a blurred teaser.
  // Bots can't download files >20MB — then the invoice just has no photo.
  try {
    const fileUrl = await botGetFileUrl(token, media.fileId);
    const res = await fetch(fileUrl);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = media.mediaType === "video" ? "mp4" : "jpg";
      const path = `botppv/${ownerId}/${unlock.id}.${ext}`;
      const { error: upErr } = await db.storage
        .from("media")
        .upload(path, buf, {
          contentType: media.mediaType === "video" ? "video/mp4" : "image/jpeg",
          upsert: true,
        });
      if (!upErr) {
        await db
          .from("stars_unlocks")
          .update({ media_path: path })
          .eq("id", unlock.id);
        unlock.media_path = path;
      }
    }
  } catch (e) {
    console.error("[ppv teaser copy]", e);
  }

  if (priceFromCaption) {
    await finalizePpv({ db, token, chatId, unlock, price: priceFromCaption });
    return;
  }

  await db.from("bot_operators").upsert(
    {
      owner_id: ownerId,
      tg_user_id: opts.operator.tg_user_id,
      pending_unlock_id: unlock.id,
    },
    { onConflict: "owner_id,tg_user_id" }
  );
  await botSendText(
    token,
    chatId,
    "Got it. How many <b>Stars</b> should this PPV cost? Reply with a number (e.g. <b>50</b>)."
  );
}

async function finalizePpv(opts: {
  db: ReturnType<typeof supabaseAdmin>;
  token: string;
  chatId: number;
  unlock: {
    id: string;
    media_path: string | null;
    media_type: string;
    caption: string | null;
  };
  price: number;
}) {
  const { db, token, chatId, unlock } = opts;
  await db
    .from("stars_unlocks")
    .update({ price_stars: opts.price, status: "pending" })
    .eq("id", unlock.id);

  try {
    await botSendPpvBubble({
      token,
      chatId,
      unlockId: unlock.id,
      mediaType: unlock.media_type === "video" ? "video" : "image",
      mediaPath: unlock.media_path,
      caption: unlock.caption,
      stars: opts.price,
    });
  } catch (e) {
    console.error("[ppv invoice]", e);
    await botSendText(
      token,
      chatId,
      "Could not create the PPV — try again."
    );
  }
}
