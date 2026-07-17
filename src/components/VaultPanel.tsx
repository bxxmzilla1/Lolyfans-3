"use client";

import VaultManager from "./VaultManager";
import { IconLock } from "./Icons";

/** Right-sidebar vault with the full feature set: upload, albums, move, delete. */
export default function VaultPanel() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-line shrink-0 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg ig-gradient flex items-center justify-center">
          <IconLock className="w-4 h-4 text-white" />
        </div>
        <h2 className="font-bold text-lg">Vault</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <VaultManager />
      </div>
    </div>
  );
}
