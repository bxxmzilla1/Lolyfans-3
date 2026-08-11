import VaultPpvMiniApp from "@/components/VaultPpvMiniApp";

export const dynamic = "force-dynamic";

/**
 * Telegram Mini App (bot menu "Vault"): the creator signs in with their
 * Lolyfans account, browses their vault, and sends items as Stars PPVs
 * into their bot chat to forward to fans.
 */
export default async function TgVaultAppPage({
  params,
}: {
  params: Promise<{ ownerId: string }>;
}) {
  const { ownerId } = await params;
  return <VaultPpvMiniApp ownerId={ownerId} />;
}
