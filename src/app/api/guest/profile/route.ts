import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId, createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";

/** Update the guest's display name and/or profile picture. */
export async function POST(req: NextRequest) {
  const chatId = await getGuestChatId();
  if (!chatId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, avatarPath } = await req.json();
  const updates: Record<string, string> = {};
  const cleanName = String(name || "").trim().slice(0, 40);
  if (cleanName) updates.guest_name = cleanName;
  if (avatarPath) updates.guest_avatar_path = String(avatarPath);
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: chat, error } = await db
    .from("chats")
    .update(updates)
    .eq("id", chatId)
    .select("id, guest_name, guest_ip")
    .single();
  if (error || !chat) {
    return NextResponse.json({ error: error?.message || "Chat not found" }, { status: 500 });
  }

  // Keep the guest's name consistent across all their chats on this device.
  if (updates.guest_name && chat.guest_ip) {
    await db.from("chats").update(updates).eq("guest_ip", chat.guest_ip);
  }

  const res = NextResponse.json({ ok: true, name: chat.guest_name });
  res.cookies.set(
    GUEST_COOKIE,
    createToken({ chatId: chat.id, name: chat.guest_name }),
    cookieOptions
  );
  return res;
}
