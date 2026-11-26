"use server";

import type { FormState } from "@/components/blocks/FormBlock";
import { currentDemo } from "@/demo/current";
import { formFields, parseForm } from "@/server/forms";

/** Demo form submit: validates like the real thing but saves nothing. */
export async function submitDemoForm(tableId: string, wantedFields: string[] | undefined, _prev: FormState, form: FormData): Promise<FormState> {
  const { blueprint } = await currentDemo();
  const parsed = parseForm(blueprint, tableId, formFields(blueprint, tableId, wantedFields), form);
  if (!parsed.ok) return parsed.state;
  return { ok: true, message: "Looks good — this is a demo, so nothing was saved.", nonce: Date.now() };
}
