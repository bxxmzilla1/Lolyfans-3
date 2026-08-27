"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import SettingsModal from "./SettingsModal";
import { IconChat, IconLock, IconGear } from "./Icons";

const tabs = [
  { href: "/inbox", label: "Chats", Icon: IconChat },
  { href: "/vault", label: "Vault", Icon: IconLock },
];

export default function BottomNav() {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const tabClass = (active: boolean) =>
    `flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
      active ? "text-accent" : "text-muted"
    }`;

  return (
    <>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <nav className="border-t border-line bg-card/80 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-2xl mx-auto flex">
          {tabs.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className={tabClass(pathname.startsWith(href))}>
              <Icon className="w-5.5 h-5.5" />
              {label}
            </Link>
          ))}
          {/* Settings (incl. invite links) opens as a modal — no page of its own */}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className={tabClass(settingsOpen)}
          >
            <IconGear className="w-5.5 h-5.5" />
            Settings
          </button>
        </div>
      </nav>
    </>
  );
}
