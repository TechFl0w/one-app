import { emptyBlueprint } from "@/schema/blueprint";
import type { Template } from "./types";
import { nailSalon } from "./nailSalon";
import { chairRental } from "./chairRental";
import { makerShop } from "./makerShop";

export type { Answers, Built, Question, Seed, Template } from "./types";

/** "Something else": one blank page; the assistant builds the rest. */
const blank: Template = {
  id: "blank",
  label: "Something else",
  description: "Start with an empty app and describe your business to the assistant.",
  businessType: "other",
  questions: [],
  build: (business) => ({ blueprint: emptyBlueprint({ ...business, type: "other" }), seed: [] }),
};

export const TEMPLATES: Template[] = [nailSalon, chairRental, makerShop, blank];
export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
