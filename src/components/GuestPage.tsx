import GuestNav from "./GuestNav";

/**
 * Shared shell for guest pages (Home, Chats, Profile, creator profiles):
 * sticky top bar on mobile, and on desktop a page title with the content in
 * a bounded card next to the sidebar so it never floats in empty space.
 */
export default function GuestPage({
  title,
  hideHeader = false,
  children,
}: {
  title?: React.ReactNode;
  /** Skip the sticky/desktop page title (e.g. creator profiles that already show the name). */
  hideHeader?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-10 lg:pl-60">
      {!hideHeader && (
        <header className="lg:hidden sticky top-0 z-30 border-b border-line2 bg-card/80 backdrop-blur-lg px-4 py-3">
          <h1 className="max-w-lg mx-auto font-bold text-lg flex items-center gap-1">
            {title}
          </h1>
        </header>
      )}

      <main className="mx-auto max-w-lg lg:max-w-2xl lg:px-8 lg:pt-8">
        {!hideHeader && (
          <h1 className="hidden lg:flex items-center gap-1 font-bold text-2xl mb-4">
            {title}
          </h1>
        )}
        <div className="lg:bg-card lg:border lg:border-line lg:rounded-2xl lg:overflow-hidden">
          {children}
        </div>
      </main>

      <GuestNav />
    </div>
  );
}
