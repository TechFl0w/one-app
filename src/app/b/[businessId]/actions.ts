"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/blocks/FormBlock";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBlueprint } from "@/server/blueprints";
import { createRecord } from "@/server/records";
import { errorState, formFields, parseForm } from "@/server/forms";

/** Form block submit: create a record in `tableId`. Bound with businessId/tableId/blockFields. */
export async function submitRecordForm(
  businessId: string,
  tableId: string,
  wantedFields: string[] | undefined,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    const supabase = await createClient();
    const blueprint = await getCurrentBlueprint(supabase, businessId);
    const parsed = parseForm(blueprint, tableId, formFields(blueprint, tableId, wantedFields), form);
    if (!parsed.ok) return parsed.state;
    await createRecord(supabase, businessId, tableId, parsed.input);
    revalidatePath(`/b/${businessId}`, "layout");
    return { ok: true, message: "Saved.", nonce: Date.now() };
  } catch (e) {
    return errorState(e);
  }
}
