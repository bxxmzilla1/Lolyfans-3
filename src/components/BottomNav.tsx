"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChat, IconLock, IconLink } from "./Icons";

const tabs = [
  { href: "/inbox", label: "Chats", Icon: IconChat },
  { href: "/vault", label: "Vault", Icon: IconLock },
  { href: "/invites", label: "Links", Icon: IconLink },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="border-t border-line bg-card/80 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-2xl mx-auto flex">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <Icon className="w-5.5 h-5.5" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
