import type { Blueprint } from "@/schema/blueprint";

import { WeeklyHours } from "@/schema/blueprint";

/**
 * An onboarding question. Answers are strings (choice; hours as JSON) or string arrays (multi/list).
 * `label`/`placeholder`/`defaultFor` may depend on earlier answers (e.g. the kind of appointments).
 */
type Dyn<T> = T | ((a: Answers) => T);
export type Question =
  | { id: string; kind: "choice"; label: Dyn<string>; options: { id: string; label: string; hint?: string }[]; default: string }
  | { id: string; kind: "multi"; label: Dyn<string>; options: { id: string; label: string; hint?: string }[]; default: string[] }
  | { id: string; kind: "list"; label: Dyn<string>; placeholder: Dyn<string>; hint?: string; max: number; default: string[]; defaultFor?: (a: Answers) => string[] }
  | { id: string; kind: "hours"; label: Dyn<string>; hint?: string; default: WeeklyHours };

export const resolve = <T>(v: Dyn<T>, a: Answers): T => (typeof v === "function" ? (v as (a: Answers) => T)(a) : v);

/** The value shown for a question before the owner touches it. */
export function initialValue(q: Question, a: Answers): string | string[] {
  if (q.kind === "hours") return JSON.stringify(q.default);
  if (q.kind === "list" && q.defaultFor) return q.defaultFor(a);
  return q.default;
}

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
  const items = (Array.isArray(v) ? v : (q.defaultFor?.(a) ?? q.default)).map((s) => String(s).trim().slice(0, 60)).filter(Boolean);
  return [...new Set(items)].slice(0, q.max);
};

/** Opening hours from the hours editor (JSON), validated; falls back to the default. */
export const hours = (a: Answers, q: Question & { kind: "hours" }): WeeklyHours => {
  const v = a[q.id];
  if (typeof v !== "string") return q.default;
  try {
    const parsed = WeeklyHours.safeParse(JSON.parse(v));
    return parsed.success && Object.keys(parsed.data).length ? parsed.data : q.default;
  } catch {
    return q.default;
  }
};
