import { guestChats } from "@/lib/guest";

/**
 * Confirm the current guest owns `chatId` (via cookie / IP / email match).
 * Payment and unlock actions are always scoped to a chat the fan holds.
 */
export async function guestOwnsChat(
  requestHeaders: Headers,
  chatId: string
): Promise<boolean> {
  const chats = await guestChats(requestHeaders);
  return chats.some((c) => c.id === chatId);
}
