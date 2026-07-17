/**
 * Streams instantly while the invite page is being rendered on the server,
 * so visitors see a profile skeleton instead of a blank screen.
 */
export default function InviteLoading() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6 min-h-dvh">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <div className="relative">
          <div className="w-[100px] h-[100px] rounded-full bg-card2 animate-pulse" />
          <span className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-card2 border-4 border-bg" />
        </div>
        <div className="h-6 w-36 rounded-full bg-card2 animate-pulse -mt-2" />
        <div className="w-full flex flex-col items-center gap-2 -mt-2">
          <div className="h-3.5 w-64 rounded-full bg-card2 animate-pulse" />
          <div className="h-3.5 w-48 rounded-full bg-card2 animate-pulse" />
        </div>
        <div className="h-12 w-full rounded-xl bg-card2 animate-pulse" />
      </div>
    </main>
  );
}
