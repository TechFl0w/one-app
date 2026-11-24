"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/** Native <dialog> modal (focus trap + Esc for free), styled as a card. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  side = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Slide-over panel on the right instead of a centered modal. */
  side?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`bg-card p-0 text-ink shadow-soft backdrop:bg-ink/25 ${
        side
          ? "m-0 ml-auto h-full max-h-none w-full max-w-md border-l border-line"
          : "m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-line"
      }`}
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-line px-6 py-4">
            <h2 className="font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-ground" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        </div>
      )}
    </dialog>
  );
}
