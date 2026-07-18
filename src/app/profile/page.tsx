import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getGuestChatId } from "@/lib/session";
import { guestChats } from "@/lib/guest";
import GuestPage from "@/components/GuestPage";
import GuestProfileEditor from "@/components/GuestProfileEditor";

export const dynamic = "force-dynamic";

/** Guest profile tab: edit picture, name, and theme. */
export default async function GuestProfilePage() {
  const requestHeaders = await headers();
  const chats = await guestChats(requestHeaders);
  if (!chats.length) redirect("/");

  // Prefer the chat the session cookie points at; fall back to the latest.
  const cookieChatId = await getGuestChatId();
  const chat = chats.find((c) => c.id === cookieChatId) ?? chats[0];

  return (
    <GuestPage title="Profile">
      <GuestProfileEditor
        initialName={chat.guest_name}
        initialAvatarPath={chat.guest_avatar_path}
      />
    </GuestPage>
  );
}
