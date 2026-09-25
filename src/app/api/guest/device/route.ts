import { NextRequest, NextResponse } from "next/server";
import { getOwnerId, createToken, GUEST_COOKIE, cookieOptions } from "@/lib/session";
import { guestChats } from "@/lib/guest";
import { ipFromHeaders } from "@/lib/invites";
import { deviceHash, findChatByDevice, rememberDevice, type DeviceTraits } from "@/lib/guestDevice";

/**
 * Runs quietly on every visit (GuestDeviceSync). Signed-in fans: this device
 * is remembered on their chats. Visitors without a session (another browser
 * on the same phone, cleared cookies): if the device + network match a fan,
 * they're signed back in — until they log out manually.
 */
export async function POST(req: NextRequest) {
  if (await getOwnerId()) return NextResponse.json({ ok: true });

  const body = (await req.json().catch(() => ({}))) as { traits?: DeviceTraits };
  const device = deviceHash(body.traits, req.headers);
  if (!device) return NextResponse.json({ ok: true });

  const ip = ipFromHeaders(req.headers);
  const chats = await guestChats(req.headers);
  if (chats.length) {
    await rememberDevice(
      chats.map((c) => c.id),
      device,
      ip
    );
    return NextResponse.json({ ok: true, signedIn: true });
  }

  const match = await findChatByDevice(device, req.headers);
  if (!match) return NextResponse.json({ ok: true, signedIn: false });

  await rememberDevice([match.id], device, ip);
  const res = NextResponse.json({ ok: true, signedIn: true, resumed: true });
  res.cookies.set(
    GUEST_COOKIE,
    createToken({ chatId: match.id, name: match.guest_name }),
    cookieOptions
  );
  return res;
}
