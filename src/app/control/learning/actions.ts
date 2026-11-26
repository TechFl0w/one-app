"use server";

import { revalidatePath } from "next/cache";
import { decideLearning } from "@/server/control";

/** Approve a pattern as advice / a template addition, dismiss it, or undo the decision. */
export async function decide(input: { businessType: string; pattern: string; kind: string; text: string; payload?: unknown; businesses: number; status: "advice" | "template" | "dismissed" | "undecided" }) {
  try {
    await decideLearning(input);
    revalidatePath("/control/learning");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn’t save that" };
  }
}
