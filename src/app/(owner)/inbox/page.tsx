import AdsterraDashboard from "@/components/AdsterraDashboard";
import LogoutButton from "@/components/LogoutButton";
import Logo from "@/components/Logo";

export const dynamic = "force-dynamic";

/** Creator home: the Adsterra earnings dashboard (the chat UI is gone). */
export default function InboxPage() {
  return (
    <div className="flex flex-col h-full">
      {/* Mobile header — desktop shows the sidebar logo instead */}
      <header className="lg:hidden shrink-0 border-b border-line px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo className="w-8 h-8" />
          <h1 className="text-2xl font-bold ig-gradient-text">LolyFans</h1>
        </div>
        <LogoutButton />
      </header>
      <div className="flex-1 min-h-0">
        <AdsterraDashboard />
      </div>
    </div>
  );
}
