import type { Answers } from "./types";

/**
 * Onboarding's open question ("What business do you run, and what do you need help with?")
 * turned into a starting point: which template, and the answers the text already gives.
 * Keyword rules, first match wins; the owner can always pick another.
 */
const RULES: { template: string; when: RegExp; answers?: Answers }[] = [
  { template: "chair_rental", when: /\b(rent(ing)? (out )?(chairs?|booths?|stations?)|chair rental|booth rent)/i },
  { template: "mechanic", when: /\b(mechanic|garage|auto ?(repair|shop)|car repair|repair cars|fix cars|cars|body ?shop|workshop|tyres?|tires?|brakes?|oil change|vehicles?)\b/i },
  { template: "contractor", when: /\b(landscap\w*|garden(ing|er)?|lawn)\b/i, answers: { trade: "landscaping" } },
  { template: "contractor", when: /\b(electric\w*|wiring|panel upgrade)\b/i, answers: { trade: "electrical" } },
  { template: "contractor", when: /\b(plumb\w*|heating|hvac|boiler)\b/i, answers: { trade: "plumbing" } },
  { template: "contractor", when: /\b(build(er|ing)|renovat\w*|carpent\w*|roofing|construction|handyman|painter|decorat\w*|contractor|trades?(man|person)?)\b/i, answers: { trade: "building" } },
  { template: "contractor", when: /\b(quotes?|estimates?|invoic\w*|scope of work|cleaning company|cleaners?)\b/i, answers: { trade: "other" } },
  { template: "appointments", when: /\b(hair|barber|stylists?|salon)\b/i, answers: { kind: "hair" } },
  { template: "appointments", when: /\b(nails?|manicure|pedicure)\b/i, answers: { kind: "nails" } },
  { template: "appointments", when: /\b(lash|brow|beauty|facial|skin|wax\w*|spa)\b/i, answers: { kind: "beauty" } },
  { template: "appointments", when: /\b(massage|wellness|yoga|pilates)\b/i, answers: { kind: "wellness" } },
  { template: "appointments", when: /\b(physio\w*|therap\w*|clinic|chiro\w*|dentist|osteo\w*|counsell?\w*)\b/i, answers: { kind: "health" } },
  { template: "appointments", when: /\b(coach\w*|tutor\w*|lessons?|teach\w*|trainer)\b/i, answers: { kind: "coaching" } },
  { template: "maker_shop", when: /\b(sell|shop|etsy|orders?|products?|handmade|make (candles|soap|jewel\w*|cakes|art)|bakery|candles?|jewel\w*)\b/i },
  { template: "appointments", when: /\b(appointments?|bookings?|book online|clients book)\b/i, answers: { kind: "other" } },
];

export function guessTemplate(text: string): { templateId: string; answers: Answers } | null {
  const t = text.trim();
  if (t.length < 3) return null;
  const rule = RULES.find((r) => r.when.test(t));
  if (!rule) return null;
  const answers: Answers = { ...(rule.answers ?? {}) };
  // What they asked for help with switches those parts on (appointments).
  if (rule.template === "appointments") {
    const extras = ["reminders"];
    if (/no.?shows?|deposits?|pay(ments?)? up ?front/i.test(t)) extras.push("deposits");
    if (/reviews?/i.test(t)) extras.push("reviews");
    if (/rebook|come back|regulars/i.test(t)) extras.push("rebook");
    if (/rooms?|stations?|chairs?|beds?/i.test(t)) extras.push("stations");
    if (extras.length > 1) answers.extras = extras;
  }
  return { templateId: rule.template, answers };
}

/** A business name from the text when it says one ("I run Studio Mila, a hair salon…"). */
export function guessName(text: string): string | null {
  const m = /\b(?:called|named|I run|we run|I own|we are|we're|I'm)\s+((?:[A-Z][\w'&.-]*\s?){1,5})/.exec(text);
  const name = m?.[1]?.trim().replace(/[,.]$/, "");
  return name && name.length >= 2 && !/^(A|An|The)$/i.test(name) ? name.slice(0, 80) : null;
}
