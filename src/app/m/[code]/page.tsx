import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { appOrigin, cpmLinkSettings, ownerIdForCpmCode } from "@/lib/cpm";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGuestChatId } from "@/lib/session";
import { onPayLinkDomain, payLinkOrigin } from "@/lib/telegramUnlock";
import CpmLanding from "@/components/CpmLanding";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "TelegramPay",
    icons: { icon: "/telegrampay-logo.webp" },
  };
}

/** Lowercase host without www. */
function hostOf(h: Headers): string {
  return (
    h.get("x-forwarded-host") ||
    h.get("host") ||
    ""
  )
    .toLowerCase()
    .replace(/^www\./, "");
}

/**
 * Chat-per-minute entry.
 *
 *  - On Lolyfans: returning fans with a saved card go straight to /chat;
 *    everyone else is redirected to the pay-link domain (/m/<code>).
 *  - On the pay-link domain: show the TelegramPay card page; after paying,
 *    the client sends them to /api/cpm/claim on Lolyfans (cookie + /chat).
 */
export default async function CpmPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: raw } = await params;
  const code = raw.trim();
  const ownerId = await ownerIdForCpmCode(code);
  if (!ownerId) notFound();

  const h = await headers();
  const onPay = await onPayLinkDomain();
  const payOrigin = payLinkOrigin("");
  const app = appOrigin();

  // Returning fan (cookie on Lolyfans) — skip the paywall.
  const guestChatId = await getGuestChatId();
  if (guestChatId) {
    const { data: chat } = await supabaseAdmin()
      .from("chats")
      .select("id, owner_id, cpm, pending, stripe_payment_method_id")
      .eq("id", guestChatId)
      .maybeSingle();
    if (
      chat &&
      chat.owner_id === ownerId &&
      chat.cpm &&
      !chat.pending &&
      chat.stripe_payment_method_id
    ) {
      // Cookie only exists on the app domain — send them there.
      if (onPay) redirect(`${app}/chat`);
      redirect("/chat");
    }
  }

  // Lolyfans link → bounce to the pay domain for the card page.
  if (!onPay && payOrigin) {
    const payHost = new URL(payOrigin).host.toLowerCase().replace(/^www\./, "");
    const here = hostOf(h);
    if (here !== payHost) {
      redirect(`${payOrigin}/m/${encodeURIComponent(code)}`);
    }
  }

  const { data: ownerUser } = await supabaseAdmin().auth.admin.getUserById(
    ownerId
  );
  const meta = (ownerUser?.user?.user_metadata ?? {}) as {
    display_name?: string;
    invite_verified?: boolean;
  };
  const settings = await cpmLinkSettings(code);

  return (
    <CpmLanding
      code={code}
      ownerName={meta.display_name || "Creator"}
      verified={!!meta.invite_verified}
      appOrigin={app}
      benefits={settings.benefits}
      slotsTotal={settings.slotsTotal}
      slotsLeft={settings.slotsLeft}
      timerMinutes={settings.timerMinutes}
    />
  );
}
