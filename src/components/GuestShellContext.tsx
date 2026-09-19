"use client";

import { createContext, useContext } from "react";

export type GuestShellCtx = {
  hasShell: boolean;
  unread: number;
  /** How many creators the fan has a chat with (>1 → the Chat tab is a list). */
  chatCount: number;
  refresh: () => void;
};

const Ctx = createContext<GuestShellCtx>({
  hasShell: false,
  unread: 0,
  chatCount: 0,
  refresh: () => {},
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
