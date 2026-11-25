import type { BookingState, Scheduling } from "@/schema/blueprint";

/**
 * Booking lifecycle: requested → held → confirmed → checked_in → completed → paid, plus
 * cancelled and no_show. States map to the owner's own status options (scheduling.statuses).
 */

export const TRANSITIONS: Record<BookingState, BookingState[]> = {
  requested: ["held", "confirmed", "cancelled"],
  held: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "completed", "cancelled", "no_show"],
  checked_in: ["completed"],
  completed: ["paid"],
  paid: [],
  cancelled: [],
  no_show: [],
};

export const canTransition = (from: BookingState, to: BookingState) => TRANSITIONS[from].includes(to);

/**
 * Lifecycle state of a status option. Several states may share an option (e.g. "Done" for both
 * completed and paid); the most advanced one wins. Unmapped options count as confirmed, so they
 * keep blocking time — the safe default.
 */
export function stateOf(sc: Scheduling, optionId: unknown): BookingState {
  const order: BookingState[] = ["paid", "completed", "checked_in", "confirmed", "held", "requested", "no_show", "cancelled"];
  for (const s of order) if (sc.statuses[s] === optionId) return s;
  return "confirmed";
}

/** The status option to store for a state (falls back along the lifecycle if unmapped). */
export function optionFor(sc: Scheduling, state: BookingState): string {
  const fallback: Partial<Record<BookingState, BookingState>> = { held: "requested", checked_in: "confirmed", paid: "completed", completed: "confirmed", no_show: "cancelled" };
  let s: BookingState | undefined = state;
  while (s) {
    if (sc.statuses[s]) return sc.statuses[s]!;
    s = fallback[s];
  }
  return sc.statuses.confirmed!;
}

/** Does this booking keep its time taken? Holds stop blocking when they expire. */
export function blocksTime(state: BookingState, holdUntil: string | null | undefined, now: Date): boolean {
  if (state === "cancelled" || state === "no_show") return false;
  if (state === "held" && holdUntil && Date.parse(holdUntil) <= now.getTime()) return false;
  return true;
}

/** Customers can cancel themselves until `cancelWindowHours` before the start. */
export function customerCanCancel(start: string, now: Date, cancelWindowHours: number): boolean {
  return Date.parse(start) - now.getTime() >= cancelWindowHours * 3_600_000;
}

/** State a new online booking starts in. */
export const initialState = (sc: Scheduling): BookingState => (sc.rules.autoConfirm ? "confirmed" : "requested");
