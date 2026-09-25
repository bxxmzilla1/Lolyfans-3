import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ipFromHeaders } from "@/lib/invites";

const SECRET = process.env.AUTH_SECRET || "lolyfans-dev-secret-change-me";

/**
 * Traits the browser reports that are the same in every browser on one
 * phone (Safari, Chrome, Instagram's in-app browser …): screen, pixel ratio,
 * timezone, language, CPU cores, touch points.
 */
export type DeviceTraits = {
  sw?: number;
  sh?: number;
  dpr?: number;
  tz?: string;
  lang?: string;
  cores?: number;
  touch?: number;
  depth?: number;
};

/** OS family + major version from the user agent ("iOS 18", "Android 14"). */
function osFromUserAgent(ua: string): string {
  const ios = ua.match(/(?:iPhone|iPad|iPod).*?OS (\d+)/i);
  if (ios) return `ios${ios[1]}`;
  const android = ua.match(/Android (\d+)/i);
  if (android) return `android${android[1]}`;
  if (/Mac OS X/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

/**
 * Stable device id: an HMAC of the browser traits + OS. Null when the traits
 * are too thin to be meaningful (bots, blocked scripts).
 */
export function deviceHash(traits: DeviceTraits | null | undefined, headers: Headers): string | null {
  if (!traits || !traits.sw || !traits.sh || !traits.tz) return null;
  const parts = [
    osFromUserAgent(headers.get("user-agent") || ""),
    Math.min(traits.sw, traits.sh),
    Math.max(traits.sw, traits.sh),
    Number(traits.dpr || 1).toFixed(2),
    String(traits.tz).slice(0, 64),
    String(traits.lang || "").slice(0, 16).toLowerCase(),
    Number(traits.cores || 0),
    Number(traits.touch || 0),
    Number(traits.depth || 0),
  ];
  return crypto.createHmac("sha256", SECRET).update(parts.join("|")).digest("base64url");
}

/**
 * The visitor's network, coarse enough to survive a mobile IP hopping inside
 * the carrier: first two IPv4 octets, or the first four IPv6 groups.
 */
export function networkPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (ip.includes(":")) return ip.toLowerCase().split(":").slice(0, 4).join(":");
  const octets = ip.split(".");
  return octets.length === 4 ? octets.slice(0, 2).join(".") : null;
}

export type DeviceChat = { id: string; guest_name: string; owner_id: string };

/**
 * A chat this device already has: same device id AND same network (a device
 * id alone could match a stranger with the same phone model). Newest first.
 */
export async function findChatByDevice(
  device: string,
  headers: Headers
): Promise<DeviceChat | null> {
  const ip = ipFromHeaders(headers);
  const network = networkPrefix(ip);
  const { data, error } = await supabaseAdmin()
    .from("chats")
    .select("id, guest_name, owner_id, guest_ip")
    .eq("guest_device", device)
    .order("last_message_at", { ascending: false })
    .limit(20);
  if (error || !data) return null;
  const match = data.find(
    (c) => (ip && c.guest_ip === ip) || (network && networkPrefix(c.guest_ip) === network)
  );
  return match ? { id: match.id, guest_name: match.guest_name, owner_id: match.owner_id } : null;
}

/** Remember this device (and current IP) on the fan's chats. Never throws. */
export async function rememberDevice(chatIds: string[], device: string, ip: string | null) {
  if (!chatIds.length) return;
  try {
    await supabaseAdmin()
      .from("chats")
      .update({ guest_device: device, ...(ip ? { guest_ip: ip } : {}) })
      .in("id", chatIds);
  } catch {
    // column not migrated yet — device memory is best-effort
  }
}
