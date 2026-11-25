import "server-only";
import type { Blueprint, Field } from "@/schema/blueprint";
import type { FormState } from "@/components/blocks/FormBlock";
import { formToInput } from "@/engine/formInput";
import { formFieldsFor } from "@/engine/blockData";
import { RecordError, tableOrThrow, validateRecordInput } from "@/engine/records";

/** Fields a form block edits (same rule as loadBlockData). */
export function formFields(blueprint: Blueprint, tableId: string, wanted?: unknown): Field[] {
  return formFieldsFor(tableOrThrow(blueprint, tableId), wanted);
}

/** Converts + validates a submitted form, or returns the error state to show. */
export function parseForm(
  blueprint: Blueprint,
  tableId: string,
  fields: Field[],
  form: FormData,
): { ok: true; input: Record<string, unknown> } | { ok: false; state: FormState } {
  const table = tableOrThrow(blueprint, tableId);
  const input = formToInput(fields, form, blueprint.business.timezone);
  try {
    validateRecordInput(table, input, "create");
    return { ok: true, input };
  } catch (e) {
    return { ok: false, state: errorState(e) };
  }
}

export function errorState(e: unknown): FormState {
  if (e instanceof RecordError) {
    return {
      ok: false,
      message: e.fieldErrors.length ? "Please check the highlighted fields." : e.message,
      fields: Object.fromEntries(e.fieldErrors.map((f) => [f.field, f.message])),
    };
  }
  console.error(e);
  return { ok: false, message: "Something went wrong. Please try again." };
}
