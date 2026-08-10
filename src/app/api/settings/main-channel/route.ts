import { NextRequest, NextResponse } from "next/server";
import { getOwnerId } from "@/lib/session";
import { getMainTelegramLink, setMainTelegramLink } from "@/lib/mainChannel";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Creator: read the site-wide main Telegram channel link. */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const link = await getMainTelegramLink();
  return NextResponse.json({ link: link || "" });
}

/**
 * Creator: save the site-wide main Telegram channel. Also mirrors into this
 * owner's user_metadata so older "go to channel" callers stay in sync.
 * Does NOT touch invite link redirect_url values.
 */
export async function PUT(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  try {
    const link = await setMainTelegramLink(String(body.link ?? ""));
    const { data: owner } = await supabaseAdmin().auth.admin.getUserById(ownerId);
    const prev = (owner?.user?.user_metadata ?? {}) as Record<string, unknown>;
    await supabaseAdmin().auth.admin.updateUserById(ownerId, {
      user_metadata: {
        ...prev,
        sub_telegram_link: link,
        sub_price_cents: 0,
        sub_trial_days: 0,
        sub_discount_pct: 0,
      },
    });
    return NextResponse.json({ link });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not save" },
      { status: 400 }
    );
  }
}
