import { redirectFansToMainChannel } from "@/lib/fanRedirect";

export const dynamic = "force-dynamic";

/** In-app fan profile removed — everyone goes to the main Telegram channel. */
export default async function FanProfilePage() {
  await redirectFansToMainChannel();
}
