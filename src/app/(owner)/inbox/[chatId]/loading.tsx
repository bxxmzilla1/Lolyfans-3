export default function ChatLoading() {
  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-line px-3 py-2.5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-card2 animate-pulse" />
        <div className="space-y-1.5">
          <div className="h-3 w-28 bg-card2 rounded animate-pulse" />
          <div className="h-2.5 w-20 bg-card2 rounded animate-pulse" />
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full ig-gradient animate-spin [mask:radial-gradient(farthest-side,transparent_calc(100%-3px),#000_0)]" />
      </div>
    </div>
  );
}
