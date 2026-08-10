import { redirect } from "next/navigation";
import { getMainTelegramLink } from "@/lib/mainChannel";

/**
 * Send a fan away from leftover Lolyfans fan surfaces (home, chat, profile…)
 * to the main Telegram channel. Falls back to "/" which itself redirects.
 */
export async function redirectFansToMainChannel(): Promise<never> {
  const link = await getMainTelegramLink();
  redirect(link || "/");
}
