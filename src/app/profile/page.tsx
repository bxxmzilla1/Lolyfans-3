import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getGuestChatId } from "@/lib/session";
import { guestChats } from "@/lib/guest";
import GuestNav from "@/components/GuestNav";
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
    <div className="min-h-dvh pb-24 lg:pb-8 lg:pl-60">
      <header className="sticky top-0 z-30 border-b border-line2 bg-card/80 backdrop-blur-lg px-4 py-3">
        <h1 className="max-w-lg mx-auto font-bold text-lg">Profile</h1>
      </header>
      <main className="max-w-lg mx-auto">
        <GuestProfileEditor
          initialName={chat.guest_name}
          initialAvatarPath={chat.guest_avatar_path}
        />
      </main>
      <GuestNav />
    </div>
  );
}
