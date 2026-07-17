import VaultManager from "@/components/VaultManager";

export const dynamic = "force-dynamic";

export default function VaultPage() {
  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-line px-4 py-3 shrink-0">
        <div className="max-w-3xl mx-auto w-full">
          <h1 className="text-xl font-bold">Vault</h1>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full p-4 pb-24 lg:pb-6">
          <VaultManager />
        </div>
      </div>
    </div>
  );
}
