import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getOwnerId } from "@/lib/session";
import { telegramConfigured } from "@/lib/telegram";

/** Current Telegram connection status for the signed-in creator. */
export async function GET() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabaseAdmin()
    .from("telegram_accounts")
    .select("status, phone, username")
    .eq("owner_id", ownerId)
    .maybeSingle();

  return NextResponse.json({
    configured: telegramConfigured(),
    status: data?.status ?? "disconnected",
    phone: data?.phone ?? null,
    username: data?.username ?? null,
  });
}

/** Disconnect: forget the stored session so no more sends can happen. */
export async function DELETE() {
  const ownerId = await getOwnerId();
  if (!ownerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabaseAdmin()
    .from("telegram_accounts")
    .upsert(
      {
        owner_id: ownerId,
        status: "disconnected",
        session: null,
        phone_code_hash: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" }
    );
  return NextResponse.json({ ok: true });
}
