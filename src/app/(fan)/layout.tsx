import GuestShell from "@/components/GuestShell";

/**
 * Persistent layout for fan Home / Chats / Profile. The shell stays mounted
 * across tab switches so content is already loaded and switching is instant.
 */
export default function FanLayout({ children }: { children: React.ReactNode }) {
  // children are unused — the shell owns the three panels and reads the URL.
  void children;
  return <GuestShell />;
}
