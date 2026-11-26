"use client";

import { useContext } from "react";
import { BoardMove } from "./DragBoard";
import { ArrowRight } from "lucide-react";

/**
 * "→ Quality check" on a board card: moves the card to the next stage in one tap, exactly like
 * dragging it there. The next stage follows the column the card is in now.
 */
export function NextStepButton({ recordId }: { recordId: string }) {
  const board = useContext(BoardMove);
  const next = board?.next(recordId);
  if (!board || !next || next.id === null) return null;
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        void board.move(recordId, next.id);
      }}
      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-ground"
      style={{ borderColor: next.color, color: next.color }}
      aria-label={`Move to ${next.label}`}
    >
      <ArrowRight className="h-3.5 w-3.5" aria-hidden /> {next.label}
    </button>
  );
}
