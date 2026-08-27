"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import GuestAppPresence from "./GuestAppPresence";
import Logo from "./Logo";
import { useGuestShell } from "./GuestShellContext";
import { IconHome, IconChat, IconUser } from "./Icons";

/**
 * Guest navigation: Home, Chat and Profile. Soft-pushes the URL so the fan
 * shell can keep panels mounted and switch instantly.
 */
export default function GuestNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { unread } = useGuestShell();
  const [, startTransition] = useTransition();
  const mobileNavRef = useRef<HTMLElement>(null);

  // Publish the footer's real rendered height (incl. safe-area inset) as a
  // CSS variable, so page bodies can pad themselves by exactly that amount
  // and content can never end up hidden underneath the footer.
  useEffect(() => {
    const nav = mobileNavRef.current;
    if (!nav) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty("--guest-nav-h", `${nav.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(nav);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--guest-nav-h");
    };
  }, []);

  function go(href: string) {
    startTransition(() => {
      router.push(href);
    });
  }

  const tabs = [
    { href: "/home", label: "Home", icon: IconHome, badge: 0 },
    { href: "/chat", label: "Chat", icon: IconChat, badge: unread },
    { href: "/profile", label: "Profile", icon: IconUser, badge: 0 },
  ];

  return (
    <>
      {/* Fan counts as online anywhere in the app, not just inside a chat */}
      <GuestAppPresence />

      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-line bg-card/70 backdrop-blur-lg">
        <div className="px-6 py-6 flex items-center gap-2.5">
          <Logo className="w-8 h-8" />
          <p className="text-2xl font-bold ig-gradient-text tracking-tight">
            LolyFans
          </p>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {tabs.map(({ href, label, icon: Icon, badge }) => {
            const active = pathname === href;
            return (
              <button
                key={href}
                type="button"
                onClick={() => go(href)}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-semibold transition-colors ${
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:text-fg hover:bg-card2"
                }`}
              >
                <Icon className="w-5.5 h-5.5" />
                {label}
                {badge > 0 && (
                  <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-bold flex items-center justify-center">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      <nav
        ref={mobileNavRef}
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-line2 bg-card/90 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]"
      >
        <div className="max-w-lg mx-auto grid grid-cols-3">
          {tabs.map(({ href, label, icon: Icon, badge }) => {
            const active = pathname === href;
            return (
              <button
                key={href}
                type="button"
                onClick={() => go(href)}
                aria-label={label}
                className={`relative flex flex-col items-center py-2 transition-colors ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <span className="relative">
                  <Icon className="w-6 h-6" />
                  {badge > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-4.5 h-4.5 px-1 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
