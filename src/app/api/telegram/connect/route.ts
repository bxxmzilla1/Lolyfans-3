import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import {
  telegramConfigured,
  tgSendCode,
  tgSignIn,
  tgSignInPassword,
} from "@/lib/telegram";

/**
 * Telegram login for the creator, driven from Settings → Telegram in three
 * steps: send-code → verify-code → (only if 2FA) verify-password. The
 * pre-sign-in session is parked in telegram_accounts.session between steps.
 */
export async function POST(req: NextRequest) {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!telegramConfigured()) {
    return NextResponse.json(
      { error: "Telegram is not configured on the server" },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const db = supabaseAdmin();

  try {
    if (action === "send-code") {
      const phone = String(body.phone || "").trim();
      if (!/^\+?\d{6,15}$/.test(phone.replace(/\s/g, ""))) {
        return NextResponse.json({ error: "Enter a valid phone number with country code" }, { status: 400 });
      }
      const { session, phoneCodeHash } = await tgSendCode(phone.replace(/\s/g, ""));
      await db.from("telegram_accounts").upsert(
        {
          owner_id: ownerId,
          status: "code_sent",
          phone: phone.replace(/\s/g, ""),
          session,
          phone_code_hash: phoneCodeHash,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" }
      );
      return NextResponse.json({ ok: true, status: "code_sent" });
    }

    if (action === "verify-code") {
      const code = String(body.code || "").trim();
      if (!code) return NextResponse.json({ error: "Enter the login code" }, { status: 400 });
      const { data: acc } = await db
        .from("telegram_accounts")
        .select("session, phone, phone_code_hash")
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (!acc?.session || !acc.phone || !acc.phone_code_hash) {
        return NextResponse.json({ error: "Start again — request a new code" }, { status: 400 });
      }
      const result = await tgSignIn({
        session: acc.session,
        phone: acc.phone,
        phoneCodeHash: acc.phone_code_hash,
        code,
      });
      if (result.status === "password_needed") {
        await db
          .from("telegram_accounts")
          .update({
            status: "password_needed",
            session: result.session,
            updated_at: new Date().toISOString(),
          })
          .eq("owner_id", ownerId);
        return NextResponse.json({ ok: true, status: "password_needed" });
      }
      await db
        .from("telegram_accounts")
        .update({
          status: "connected",
          session: result.session,
          username: result.username,
          phone_code_hash: null,
          updated_at: new Date().toISOString(),
        })
        .eq("owner_id", ownerId);
      return NextResponse.json({ ok: true, status: "connected", username: result.username });
    }

    if (action === "verify-password") {
      const password = String(body.password || "");
      if (!password) return NextResponse.json({ error: "Enter your 2FA password" }, { status: 400 });
      const { data: acc } = await db
        .from("telegram_accounts")
        .select("session")
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (!acc?.session) {
        return NextResponse.json({ error: "Start again — request a new code" }, { status: 400 });
      }
      const result = await tgSignInPassword({ session: acc.session, password });
      await db
        .from("telegram_accounts")
        .update({
          status: "connected",
          session: result.session,
          username: result.username,
          phone_code_hash: null,
          updated_at: new Date().toISOString(),
        })
        .eq("owner_id", ownerId);
      return NextResponse.json({ ok: true, status: "connected", username: result.username });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Telegram error";
    // Surface Telegram's own error codes in a friendlier way.
    const friendly = /PHONE_NUMBER_INVALID/.test(msg)
      ? "That phone number isn't valid"
      : /PHONE_CODE_INVALID/.test(msg)
        ? "That login code is wrong"
        : /PHONE_CODE_EXPIRED/.test(msg)
          ? "That code expired — request a new one"
          : /PASSWORD_HASH_INVALID/.test(msg)
            ? "That 2FA password is wrong"
            : /FLOOD_WAIT/.test(msg)
              ? "Too many attempts — wait a bit and try again"
              : msg;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }
}
