import { redirect } from "next/navigation";
import { getGuestChatId } from "@/lib/session";
import { guestChatAccessDestination } from "@/lib/subscriptionAccess";
import GuestShell from "@/components/GuestShell";

/**
 * Persistent layout for fan Home / Chats / Profile. The shell stays mounted
 * across tab switches so content is already loaded and switching is instant.
 * Paid profiles: unpaid guests are sent back to the card step.
 */
export default async function FanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // children are unused — the shell owns the three panels and reads the URL.
  void children;

  const chatId = await getGuestChatId();
  if (chatId) {
    const access = await guestChatAccessDestination(chatId);
    if (!access.allowed) redirect(access.href);
  }

  return <GuestShell />;
}
