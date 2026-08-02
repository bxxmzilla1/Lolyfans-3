import TelegramChatView from "@/components/TelegramChatView";

export const dynamic = "force-dynamic";

/**
 * One Telegram dialog for the creator: replies + Send PPV into that peer.
 * Peer is URL-encoded (e.g. user%3Aid%3Ahash or %40username).
 */
export default async function TelegramInboxChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ peer: string }>;
  searchParams: Promise<{ title?: string }>;
}) {
  const { peer: rawPeer } = await params;
  const { title: rawTitle } = await searchParams;
  const peer = decodeURIComponent(rawPeer);
  const title = rawTitle ? decodeURIComponent(rawTitle) : peer.startsWith("@") ? peer : "Telegram";

  return <TelegramChatView peer={peer} title={title} />;
}
