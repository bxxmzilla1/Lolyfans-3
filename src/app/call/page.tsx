import { redirectFansToMainChannel } from "@/lib/fanRedirect";

export const dynamic = "force-dynamic";

/** Voice calls removed with in-app chat — fans go to the main Telegram channel. */
export default async function CallPage() {
  await redirectFansToMainChannel();
}
