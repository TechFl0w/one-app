"use server";

import { revalidatePath } from "next/cache";
import { cancelByLink } from "@/server/bookingLinks";
import { RecordError } from "@/engine/records";

export async function cancelBooking(slug: string, token: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await cancelByLink(token);
    revalidatePath(`/book/${slug}/b/${token}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof RecordError ? e.message : "Something went wrong. Please try again." };
  }
}
