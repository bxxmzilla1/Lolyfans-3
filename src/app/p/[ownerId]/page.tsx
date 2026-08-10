import { redirectFansToMainChannel } from "@/lib/fanRedirect";

export const dynamic = "force-dynamic";

/** Public creator profiles removed — visitors go to the main Telegram channel. */
export default async function PublicProfilePage() {
  await redirectFansToMainChannel();
}
