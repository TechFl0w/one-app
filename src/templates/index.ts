import { emptyBlueprint } from "@/schema/blueprint";
import type { Template } from "./types";
import { appointments } from "./appointments";
import { chairRental } from "./chairRental";
import { makerShop } from "./makerShop";

export type { Answers, Built, Question, Seed, Template } from "./types";

/** "Something else": one blank page; the assistant builds the rest. */
const blank: Template = {
  id: "blank",
  label: "Something else",
  description: "Start empty and describe what you need to the assistant.",
  businessType: "other",
  questions: [],
  build: (business) => ({ blueprint: emptyBlueprint({ ...business, type: "other" }), seed: [] }),
};

export const TEMPLATES: Template[] = [appointments, chairRental, makerShop, blank];
export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
