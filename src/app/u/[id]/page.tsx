import { notFound } from "next/navigation";
import { ownerProfiles } from "@/lib/guest";
import { mediaUrl } from "@/lib/utils";
import { getUnlock } from "@/lib/telegramUnlock";
import {
  getTelegramFan,
  telegramFanRow,
  telegramLoginBotUsername,
} from "@/lib/telegramLogin";
import TelegramUnlockView from "@/components/TelegramUnlockView";

export const dynamic = "force-dynamic";

/**
 * Public unlock page opened from a Telegram DM link. Shows the creator, a
 * locked preview and the price; paying (one-tap with a saved card, or the
 * card wizard) delivers the clear media into the fan's Telegram DM. The real
 * media URL is never sent to this page — only a locked placeholder.
 *
 * Fans can log in with the Telegram Login Widget so their card is saved
 * against their verified Telegram identity — no Lolyfans account needed.
 */
export default async function TelegramUnlockPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const unlock = await getUnlock(id);
  if (!unlock) notFound();

  const [profiles, tgFan] = await Promise.all([
    ownerProfiles([unlock.owner_id]),
    getTelegramFan(),
  ]);
  const owner = profiles.get(unlock.owner_id);

  // Already logged in with Telegram? Show who, and whether one-tap is ready.
  let tgLogin: { name: string; hasCard: boolean } | null = null;
  if (tgFan) {
    const row = await telegramFanRow(tgFan.id);
    tgLogin = {
      name: row?.username
        ? `@${row.username}`
        : tgFan.username
          ? `@${tgFan.username}`
          : row?.first_name || "Telegram",
      hasCard: !!(row?.stripe_customer_id && row?.stripe_payment_method_id),
    };
  }

  return (
    <TelegramUnlockView
      id={unlock.id}
      ownerName={owner?.name ?? "Creator"}
      avatarUrl={owner?.avatarPath ? mediaUrl(owner.avatarPath) : null}
      verified={owner?.verified ?? false}
      mediaType={unlock.media_type}
      priceCents={unlock.price_cents}
      alreadyUnlocked={unlock.status === "paid" || !!unlock.delivered_at}
      botUsername={telegramLoginBotUsername()}
      initialTgLogin={tgLogin}
    />
  );
}
