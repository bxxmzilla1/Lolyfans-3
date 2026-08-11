import TelegramChatList from "@/components/TelegramChatList";
import StarsChatList from "@/components/StarsChatList";
import LogoutButton from "@/components/LogoutButton";
import Logo from "@/components/Logo";
import { IconChat } from "@/components/Icons";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  return (
    <>
      {/* Mobile: Stars Mini App chats + Telegram channels */}
      <div className="lg:hidden flex flex-col h-full">
        <header className="border-b border-line px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo className="w-8 h-8" />
            <h1 className="text-2xl font-bold ig-gradient-text">LolyFans</h1>
          </div>
          <LogoutButton />
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain touch-pan-y pb-20">
          <StarsChatList />
          <p className="px-5 pt-2 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
            Telegram channels
          </p>
          <TelegramChatList />
        </div>
      </div>

      {/* Desktop: pick a chat from the sidebar */}
      <div className="hidden lg:flex h-full flex-col items-center justify-center gap-4 text-center p-8">
        <div className="w-20 h-20 rounded-3xl ig-gradient glow-accent flex items-center justify-center">
          <IconChat className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-xl font-bold">Inbox</h2>
        <p className="text-muted text-sm max-w-xs">
          Select a Stars Mini App chat or Telegram channel on the left.
          Connect a bot in Settings → Stars Mini App to earn with Telegram
          Stars.
        </p>
      </div>
    </>
  );
}
