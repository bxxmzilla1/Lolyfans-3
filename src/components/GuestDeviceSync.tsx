"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { deviceTraits } from "@/lib/deviceTraits";

const OWNER_PATHS = /^\/(inbox|vault|settings|admin)/;
const SYNCED_KEY = "loly_device_synced";

/**
 * Background device memory for fans: remembers this phone on their chats,
 * and signs them back in from any other browser on it (until they log out).
 */
export default function GuestDeviceSync() {
  const pathname = usePathname();

  useEffect(() => {
    if (OWNER_PATHS.test(pathname)) return;
    try {
      if (sessionStorage.getItem(SYNCED_KEY)) return;
      sessionStorage.setItem(SYNCED_KEY, "1");
    } catch {
      // storage blocked — sync every load
    }
    fetch("/api/guest/device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ traits: deviceTraits() }),
    })
      .then((r) => r.json())
      .then((data: { resumed?: boolean }) => {
        if (data.resumed) window.location.reload();
      })
      .catch(() => {});
  }, [pathname]);

  return null;
}
