"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconStar } from "./Icons";

type Chat = {
  id: string;
  name: string;
  username: string | null;
  preview: string;
  lastMessageAt: string;
};

export default function StarsChatList() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [needsMigration, setNeedsMigration] = useState(false);
  const pathname = usePathname();

  async function load() {
    const res = await fetch("/api/stars/chats").catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setChats(data.chats ?? []);
    setNeedsMigration(!!data.needsMigration);
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, []);

  if (needsMigration) {
    return (
      <p className="px-5 py-2 text-xs text-amber-400">
        Run the Stars tables migration in Supabase to enable Mini App chats.
      </p>
    );
  }

  if (chats.length === 0) return null;

  return (
    <div className="mb-2">
      <p className="px-5 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-widest text-amber-400/90 flex items-center gap-1.5">
        <IconStar className="w-3 h-3" /> Stars Mini App
      </p>
      <ul>
        {chats.map((c) => {
          const href = `/inbox/stars/${c.id}`;
          const active = pathname === href;
          return (
            <li key={c.id}>
              <Link
                href={href}
                className={`flex items-center gap-3 px-5 py-3 transition-colors ${
                  active ? "bg-amber-500/15" : "hover:bg-card2/80"
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                  <IconStar className="w-5 h-5 text-amber-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate text-amber-100">
                    {c.name}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {c.preview || "No messages yet"}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
