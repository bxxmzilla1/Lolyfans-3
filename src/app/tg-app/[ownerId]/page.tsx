import StarsMiniApp from "@/components/StarsMiniApp";

export const dynamic = "force-dynamic";

/**
 * Telegram Mini App entry. Configure this URL as the bot's Web App / menu
 * button in BotFather (we also set it automatically when the bot connects).
 * Fans chat here and unlock PPVs with Telegram Stars.
 */
export default async function TgAppPage({
  params,
}: {
  params: Promise<{ ownerId: string }>;
}) {
  const { ownerId } = await params;
  return <StarsMiniApp ownerId={ownerId} />;
}
