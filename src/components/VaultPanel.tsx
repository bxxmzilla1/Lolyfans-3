"use client";

import VaultManager from "./VaultManager";

/** Right-sidebar vault with the full feature set: upload, albums, move, delete. */
export default function VaultPanel() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-line shrink-0">
        <h2 className="font-bold text-lg">Vault</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <VaultManager />
      </div>
    </div>
  );
}
