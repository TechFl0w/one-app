import type { Blueprint } from "@/schema/blueprint";

/** An onboarding question. Answers are strings (choice/text) or string arrays (multi). */
export type Question =
  | { id: string; kind: "choice"; label: string; options: { id: string; label: string; hint?: string }[]; default: string }
  | { id: string; kind: "multi"; label: string; options: { id: string; label: string; hint?: string }[]; default: string[] }
  | { id: string; kind: "list"; label: string; placeholder: string; hint?: string; max: number; default: string[] };

export type Answers = Record<string, string | string[]>;

/** Starter records created right after the business (e.g. the team, services). */
export interface Seed {
  table: string;
  data: Record<string, unknown>;
}

export interface Built {
  blueprint: Blueprint;
  seed: Seed[];
}

export interface Template {
  id: string;
  label: string;
  description: string;
  businessType: string;
  questions: Question[];
  /** Builds a complete, valid blueprint (version 1) from the answers, plus starter records. */
  build(business: { name: string; timezone: string }, answers: Answers): Built;
}

export const answer = (a: Answers, q: Question): string | string[] => a[q.id] ?? q.default;
export const choice = (a: Answers, q: Question & { kind: "choice" }) => {
  const v = a[q.id];
  return typeof v === "string" && q.options.some((o) => o.id === v) ? v : q.default;
};
export const multi = (a: Answers, q: Question & { kind: "multi" }) => {
  const v = a[q.id];
  return Array.isArray(v) ? v.filter((x) => q.options.some((o) => o.id === x)) : q.default;
};
export const list = (a: Answers, q: Question & { kind: "list" }) => {
  const v = a[q.id];
  const items = (Array.isArray(v) ? v : q.default).map((s) => String(s).trim().slice(0, 60)).filter(Boolean);
  return [...new Set(items)].slice(0, q.max);
};
