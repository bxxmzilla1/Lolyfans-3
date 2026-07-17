import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId, GUEST_COOKIE } from "@/lib/session";

/**
 * Owner escape hatch: verifies the admin code, deletes the guest chat that was
 * just exited (messages cascade), and clears the guest cookie.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.ADMIN_CODE;
  if (!expected) {
    return NextResponse.json(
      { error: "Admin code is not configured. Set ADMIN_CODE in the environment." },
      { status: 503 }
    );
  }

  const { code } = await req.json();
  if (code !== expected) {
    return NextResponse.json({ error: "Invalid admin code" }, { status: 403 });
  }

  const chatId = await getGuestChatId();
  if (chatId) {
    // Deleting the chat cascades to its messages (FK on delete cascade)
    await supabaseAdmin().from("chats").delete().eq("id", chatId);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(GUEST_COOKIE);
  return res;
}
