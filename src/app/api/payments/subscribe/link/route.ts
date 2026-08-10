import { NextResponse } from "next/server";
import { getMainTelegramLink } from "@/lib/mainChannel";

/**
 * Site-wide main Telegram channel link. Kept under this path so existing
 * client callers (goToChannel) keep working. Invite links do not use this.
 */
export async function GET() {
  const link = await getMainTelegramLink();
  return NextResponse.json({ link: link || null });
}
