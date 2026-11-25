"use server";

import type { FormState } from "@/components/blocks/FormBlock";
import { demoBlueprint } from "@/demo/salon";
import { formFields, parseForm } from "@/server/forms";

/** Demo form submit: validates like the real thing but saves nothing. */
export async function submitDemoForm(tableId: string, wantedFields: string[] | undefined, _prev: FormState, form: FormData): Promise<FormState> {
  const parsed = parseForm(demoBlueprint, tableId, formFields(demoBlueprint, tableId, wantedFields), form);
  if (!parsed.ok) return parsed.state;
  return { ok: true, message: "Looks good — this is a demo, so nothing was saved.", nonce: Date.now() };
}
