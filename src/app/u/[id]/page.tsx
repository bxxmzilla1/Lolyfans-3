import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ownerProfiles } from "@/lib/guest";
import { mediaUrl } from "@/lib/utils";
import { getUnlock, onPayLinkDomain } from "@/lib/telegramUnlock";
import TelegramUnlockView from "@/components/TelegramUnlockView";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return (await onPayLinkDomain())
    ? { title: "TelegramPay", icons: { icon: "/telegrampay-logo.webp" } }
    : {};
}

/**
 * Public unlock page opened from a Telegram DM link. Shows the creator, a
 * locked preview and the price; paying (one-tap with a saved card, or the
 * card wizard) delivers the clear media into the fan's Telegram DM. The real
 * media URL is never sent to this page — only a locked placeholder.
 */
export default async function TelegramUnlockPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const unlock = await getUnlock(id);
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
