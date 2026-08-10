import { redirectFansToMainChannel } from "@/lib/fanRedirect";

export const dynamic = "force-dynamic";

/** In-app chat removed — fans go to the main Telegram channel. */
export default async function GuestChatPage() {
  await redirectFansToMainChannel();
}
