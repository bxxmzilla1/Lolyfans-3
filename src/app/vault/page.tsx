import { redirect } from "next/navigation";
import { getOwnerId } from "@/lib/session";
import BottomNav from "@/components/BottomNav";
import VaultManager from "@/components/VaultManager";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  if (!(await getOwnerId())) redirect("/");

  return (
    <div className="flex flex-col h-dvh">
      <header className="border-b border-line px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-xl font-bold">Vault</h1>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4">
          <VaultManager />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
