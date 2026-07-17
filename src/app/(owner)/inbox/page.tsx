import ChatList from "@/components/ChatList";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  return (
    <>
      {/* Mobile: full chat list */}
      <div className="lg:hidden flex flex-col h-full">
        <header className="border-b border-line px-4 py-3 flex items-center justify-between">
          <h1 className="text-2xl font-bold ig-gradient-text">Lolyfans</h1>
          <LogoutButton />
        </header>
        <div className="flex-1 overflow-y-auto pb-20">
          <ChatList />
        </div>
      </div>

      {/* Desktop: pick a chat from the sidebar */}
      <div className="hidden lg:flex h-full flex-col items-center justify-center gap-4 text-center p-8">
        <div className="ig-ring">
          <div className="w-24 h-24 rounded-full bg-bg flex items-center justify-center text-5xl">
            💬
          </div>
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
