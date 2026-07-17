import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { inviteUsable, countryAllowed, ipFromHeaders, Invite } from "@/lib/invites";
import { mediaUrl } from "@/lib/utils";
import JoinForm from "@/components/JoinForm";
import InviteProfile from "@/components/InviteProfile";
import { IconMapPin } from "@/components/Icons";

export const dynamic = "force-dynamic";

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Visitor's "City, Country" via ipinfo.io, falling back to Vercel's geo headers. */
async function visitorLocation(h: Headers): Promise<string | null> {
  const ip = ipFromHeaders(h);
  try {
    const token = process.env.IPINFO_TOKEN;
    const url = `https://ipinfo.io/${ip ? `${ip}/` : ""}json${token ? `?token=${token}` : ""}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { city?: string; country?: string };
      if (data.city && data.country) {
        return `${data.city}, ${countryName(data.country)}`;
      }
    }
  } catch {
    // ipinfo unreachable or rate limited; use the header fallback below
  }
  const city = h.get("x-vercel-ip-city");
  const country = h.get("x-vercel-ip-country");
  if (city && country) {
    return `${decodeURIComponent(city)}, ${countryName(country)}`;
  }
  return null;
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const db = supabaseAdmin();

  // Only resume an existing chat; a cookie left from a deleted chat must not
  // block a fresh invite (it would otherwise bounce the visitor to sign-in).
  const guestChatId = await getGuestChatId();
  if (guestChatId) {
    const { data: existing } = await db
      .from("chats")
      .select("id")
      .eq("id", guestChatId)
      .maybeSingle();
    if (existing) redirect("/chat");
  }

  const { data: invite } = await db
    .from("invites")
    .select("*")
    .eq("code", code)
    .single<Invite>();

  const usable = inviteUsable(invite);
  const requestHeaders = await headers();
  const country =
    requestHeaders.get("x-vercel-ip-country")?.toUpperCase() || null;
  const allowed = invite ? countryAllowed(invite.allowed_countries, country) : false;
  const location = await visitorLocation(requestHeaders);

  const blockedReason = !usable.ok
    ? usable.reason
    : !allowed
    ? "This chat link is not available in your country."
    : null;

  // The profile of whoever created this link
  let ownerName = "Lolyfans";
  let avatarPath: string | null = null;
  if (invite) {
    const { data: ownerUser } = await db.auth.admin.getUserById(invite.owner_id);
    const meta = (ownerUser?.user?.user_metadata ?? {}) as {
      display_name?: string;
      avatar_path?: string;
    };
    ownerName = meta.display_name || "Lolyfans";
    avatarPath = meta.avatar_path || null;
  }

  // Rendered fresh on every visit: reads as recently active without live presence
  const minutesAgo = 2 + Math.floor(Math.random() * 4); // 2-5

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        {location && (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-card2 border border-line px-3 py-1.5 text-xs text-muted">
            <IconMapPin className="w-3.5 h-3.5 text-accent" />
            {location}
          </p>
        )}
        <InviteProfile
          name={ownerName}
          avatarUrl={avatarPath ? mediaUrl(avatarPath) : null}
          minutesAgo={minutesAgo}
        />

        <div className="text-center -mt-2">
          <p className="text-muted text-sm">
            {blockedReason
              ? blockedReason
              : `${ownerName} invited you to a private chat. Pick a name and start chatting — no sign-up needed.`}
          </p>
        </div>
        {!blockedReason && (
          <JoinForm
            code={code}
            inviterName={ownerName}
            avatarUrl={avatarPath ? mediaUrl(avatarPath) : null}
          />
        )}
      </div>
    </main>
  );
}
