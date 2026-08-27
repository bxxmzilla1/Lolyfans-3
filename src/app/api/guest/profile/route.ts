import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId, createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { getAutoRefillEnabled, setAutoRefillEnabled } from "@/lib/payments";
import { stripeConfigured } from "@/lib/stripe";

/** Guest settings shown in the Profile tab (currently: the auto-refill switch). */
export async function GET() {
  const chatId = await getGuestChatId();
  if (!chatId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let autoRefill = true;
  if (stripeConfigured()) {
    try {
      autoRefill = await getAutoRefillEnabled(chatId);
    } catch {
      // Stripe hiccup — report the default.
    }
  }
  return NextResponse.json({ autoRefill });
}

/** Update the guest's display name, profile picture and/or auto-refill switch. */
export async function POST(req: NextRequest) {
  const chatId = await getGuestChatId();
  if (!chatId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, avatarPath, autoRefill } = await req.json();

  if (typeof autoRefill === "boolean") {
    if (!stripeConfigured()) {
      return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });
    }
    try {
      await setAutoRefillEnabled(chatId, autoRefill);
    } catch {
      return NextResponse.json({ error: "Could not save the setting" }, { status: 502 });
    }
    if (name === undefined && avatarPath === undefined) {
      return NextResponse.json({ ok: true, autoRefill });
    }
  }

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
