import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  newWebhookSecret,
  setBotWebhook,
  validateBotToken,
} from "@/lib/telegramBot";

/** GET: bot connection status for Settings (never leaks the full token). */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabaseAdmin()
    .from("telegram_bots")
    .select("bot_username, bot_id, updated_at")
    .eq("owner_id", ownerId)
    .maybeSingle();

  return NextResponse.json({
    connected: !!data,
    botUsername: data?.bot_username ?? null,
    botId: data?.bot_id ?? null,
    botLink: data?.bot_username ? `https://t.me/${data.bot_username}` : null,
  });
}

/** PUT: save bot token and set the PPV webhook. */
export async function PUT(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    return NextResponse.json(
      { error: "Paste a valid bot token from @BotFather" },
      { status: 400 }
    );
  }

  try {
    const me = await validateBotToken(token);
    const secret = newWebhookSecret();
    await setBotWebhook(token, ownerId, secret);

    const { error } = await supabaseAdmin().from("telegram_bots").upsert(
      {
        owner_id: ownerId,
        bot_token: token,
        bot_username: me.username,
        bot_id: me.id,
        webhook_secret: secret,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" }
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      botUsername: me.username,
      botLink: `https://t.me/${me.username}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not connect bot" },
      { status: 400 }
    );
  }
}

/** DELETE: disconnect bot and clear webhook. */
export async function DELETE() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabaseAdmin()
    .from("telegram_bots")
    .select("bot_token")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (data?.bot_token) {
    await fetch(
      `https://api.telegram.org/bot${data.bot_token}/deleteWebhook`,
      { method: "POST" }
    ).catch(() => {});
  }

  await supabaseAdmin().from("telegram_bots").delete().eq("owner_id", ownerId);
  return NextResponse.json({ ok: true });
}
