import { redirectFansToMainChannel } from "@/lib/fanRedirect";

export const dynamic = "force-dynamic";

/** Fan login removed — users go to the main Telegram channel. */
export default async function LoginPage() {
  await redirectFansToMainChannel();
}
