"use client";

import Portal from "./Portal";
import { IconTrash } from "./Icons";

/** Themed replacement for the browser's confirm() dialog. */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Portal>
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs bg-card border border-line rounded-2xl p-4 space-y-3 fade-up"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0">
            <IconTrash className="w-4.5 h-4.5 text-red-400" />
          </div>
          <p className="font-bold">{title}</p>
        </div>
        <p className="text-sm text-muted">{message}</p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 bg-card2 border border-line rounded-xl py-2.5 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-semibold active:opacity-80 transition-opacity"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
