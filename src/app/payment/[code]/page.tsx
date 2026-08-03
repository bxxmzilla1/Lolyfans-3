import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ownerProfiles } from "@/lib/guest";
import { mediaUrl } from "@/lib/utils";
import { getUnlockByCode, onPayLinkDomain } from "@/lib/telegramUnlock";
import TelegramUnlockView from "@/components/TelegramUnlockView";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return (await onPayLinkDomain())
    ? { title: "TelegramPay", icons: { icon: "/telegrampay-logo.webp" } }
    : {};
}

/**
 * Short PPV pay link sent in Telegram DMs (lolyfans.com/payment/<code>).
 * Same unlock experience as /u/<id>, just a cleaner, shorter URL.
 */
export default async function ShortPaymentPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const unlock = await getUnlockByCode(code);
  if (!unlock) notFound();

  const profiles = await ownerProfiles([unlock.owner_id]);
  const owner = profiles.get(unlock.owner_id);

  return (
    <TelegramUnlockView
      id={unlock.id}
      ownerName={owner?.name ?? "Creator"}
      avatarUrl={owner?.avatarPath ? mediaUrl(owner.avatarPath) : null}
      verified={owner?.verified ?? false}
      mediaType={unlock.media_type}
      priceCents={unlock.price_cents}
      alreadyUnlocked={
        unlock.status === "paid" ||
        unlock.status === "delivering" ||
        !!unlock.delivered_at
      }
      brand={await onPayLinkDomain()}
    />
  );
}
