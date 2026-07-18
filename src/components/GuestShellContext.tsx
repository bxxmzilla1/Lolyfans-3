"use client";

import { createContext, useContext } from "react";

export type GuestShellCtx = {
  hasShell: boolean;
  unread: number;
  refresh: () => void;
  /** Clear one chat's unread (that conversation was opened). */
  clearChatUnread: (chatId: string) => void;
};

const Ctx = createContext<GuestShellCtx>({
  hasShell: false,
  unread: 0,
  refresh: () => {},
  clearChatUnread: () => {},
});

export function GuestShellProvider({
  value,
  children,
}: {
  value: GuestShellCtx;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGuestShell() {
  return useContext(Ctx);
}
