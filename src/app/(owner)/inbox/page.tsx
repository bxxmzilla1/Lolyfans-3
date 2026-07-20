import ChatList from "@/components/ChatList";
import LogoutButton from "@/components/LogoutButton";
import Logo from "@/components/Logo";
import { IconChat } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  return (
    <>
      {/* Mobile: full chat list */}
      <div className="lg:hidden flex flex-col h-full">
        <header className="border-b border-line px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo className="w-8 h-8" />
            <h1 className="text-2xl font-bold ig-gradient-text">Lolyfans</h1>
          </div>
          <LogoutButton />
        </header>
        <div className="flex-1 overflow-y-auto pb-20">
          <ChatList />
        </div>
      </div>

      {/* Desktop: pick a chat from the sidebar */}
      <div className="hidden lg:flex h-full flex-col items-center justify-center gap-4 text-center p-8">
        <div className="w-20 h-20 rounded-3xl ig-gradient glow-accent flex items-center justify-center">
          <IconChat className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-xl font-bold">Your messages</h2>
        <p className="text-muted text-sm max-w-xs">
          Select a chat from the left to start messaging, or share an invite
          link to get new people in.
        </p>
      </div>
    </>
  );
}
