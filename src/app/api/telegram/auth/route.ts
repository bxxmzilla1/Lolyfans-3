import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cookieOptions } from "@/lib/session";
import {
  TG_FAN_COOKIE,
  createTgFanToken,
  telegramLoginConfigured,
  verifyTelegramLogin,
} from "@/lib/telegramLogin";

/**
 * Telegram Login Widget callback: the widget posts the fan's Telegram
 * identity here. We verify the signature against the bot token, remember the
 * fan (telegram_fans) and set a signed cookie, so unlock payments can be
 * saved against their Telegram user id — no Lolyfans sign-up needed.
 */
export async function POST(req: NextRequest) {
  if (!telegramLoginConfigured()) {
    return NextResponse.json(
      { error: "Telegram login is not configured" },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const user = verifyTelegramLogin(body);
  if (!user) {
    return NextResponse.json(
      { error: "Telegram login could not be verified" },
      { status: 403 }
    );
  }

  // Upsert keeps the saved Stripe card from previous logins intact.
  await supabaseAdmin()
    .from("telegram_fans")
    .upsert(
      {
        tg_user_id: user.id,
        username: user.username ?? null,
        first_name: user.first_name ?? null,
        photo_url: user.photo_url ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tg_user_id" }
    );

  const res = NextResponse.json({
    ok: true,
    username: user.username ?? null,
    firstName: user.first_name ?? null,
  });
  res.cookies.set(TG_FAN_COOKIE, createTgFanToken(user), cookieOptions);
  return res;
}

/** Log the Telegram fan out (clears the cookie only). */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(TG_FAN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
