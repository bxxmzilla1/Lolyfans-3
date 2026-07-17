import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ipFromHeaders } from "@/lib/invites";
import { getGuestChatId, GUEST_COOKIE } from "@/lib/session";

/**
 * Owner escape hatch: verifies the admin code, deletes the guest chat that was
 * just exited (messages cascade), scrubs the visitor's IP from the database so
 * they can't be auto-resumed, and clears the guest cookie.
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

  const db = supabaseAdmin();
  const chatId = await getGuestChatId();
  if (chatId) {
    // Deleting the chat cascades to its messages (FK on delete cascade)
    await db.from("chats").delete().eq("id", chatId);
  }

  // Remove this visitor's IP from any remaining chats so the /?resume flow
  // can't send them back into an old conversation.
  const ip = ipFromHeaders(req.headers);
  if (ip) {
    await db.from("chats").update({ guest_ip: null }).eq("guest_ip", ip);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(GUEST_COOKIE);
  return res;
}
