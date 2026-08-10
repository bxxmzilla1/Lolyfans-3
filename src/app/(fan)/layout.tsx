import { redirectFansToMainChannel } from "@/lib/fanRedirect";

/**
 * Fan shell removed — Home / Profile (and any other (fan) route) bounce
 * straight to the main Telegram channel with no Lolyfans UI.
 */
export default async function FanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  void children;
  await redirectFansToMainChannel();
}
