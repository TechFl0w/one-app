import type { Blueprint, Site, SiteSection } from "@/schema/blueprint";

/**
 * The first version of a business's website, made from its own setup: a hero with its name, its
 * services and team (live), opening hours and where to find it, and a contact form that adds a
 * lead or client. The owner (or the assistant) changes it from there.
 */
const TAGLINES: [RegExp, string][] = [
  [/nail|beauty|spa|lash|brow/, "Treat yourself — book online any time."],
  [/salon|hair|barber/, "Cuts, colour and care — book in a minute."],
  [/groom|pet|dog/, "Happy, clean pets — book their next groom online."],
  [/clean/, "A spotless home, every time."],
  [/mechanic|auto|garage/, "Honest repairs, done right the first time."],
  [/landscap|garden/, "Beautiful outdoor spaces, built to last."],
  [/electric/, "Safe, certified electrical work."],
  [/plumb/, "Fast, reliable plumbing."],
  [/contractor|build|reno/, "Quality work, clear quotes."],
  [/rent/, "Space that works for you."],
];

export function tagline(bp: Blueprint): string {
  const t = `${bp.business.type} ${bp.business.name}`.toLowerCase();
  return TAGLINES.find(([re]) => re.test(t))?.[1] ?? "Get in touch — we’d love to help.";
}

/** The table a contact form can add people to: leads first, else clients or customers. */
export function contactTarget(bp: Blueprint): Site["contact"] {
  const pick = bp.tables.find((t) => /lead|enquir|inquir/i.test(t.label)) ?? (bp.scheduling ? bp.tables.find((t) => t.id === bp.scheduling!.clients.table) : undefined) ?? bp.tables.find((t) => /client|customer/i.test(t.label));
  if (!pick) return undefined;
  const name = pick.fields.find((f) => f.id === pick.primaryField && f.type === "text") ?? pick.fields.find((f) => f.type === "text");
  if (!name) return undefined;
  const email = pick.fields.find((f) => f.type === "email");
  const phone = pick.fields.find((f) => f.type === "phone");
  const message = pick.fields.find((f) => f.type === "long_text" && /note|message|request|detail/i.test(f.label)) ?? pick.fields.find((f) => f.type === "long_text");
  return { table: pick.id, name: name.id, ...(email ? { email: email.id } : {}), ...(phone ? { phone: phone.id } : {}), ...(message ? { message: message.id } : {}) };
}

export function defaultSite(bp: Blueprint): Site {
  const sc = bp.scheduling;
  const contact = contactTarget(bp);
  const sections: SiteSection[] = [
    { id: "sec_hero", type: "hero", title: bp.business.name, subtitle: tagline(bp), cta: sc ? "book" : contact ? "contact" : bp.business.phone ? "call" : undefined },
    ...(sc ? [{ id: "sec_services", type: "services" as const, title: "Services & prices" }] : []),
    ...(sc ? [{ id: "sec_team", type: "team" as const, title: "Meet the team" }] : []),
    ...(sc || bp.business.address ? [{ id: "sec_hours", type: "hours" as const, title: sc ? "Opening hours" : "Find us" }] : []),
    ...(contact ? [{ id: "sec_contact", type: "contact" as const, title: sc ? "Questions? Get in touch" : "Ask for a quote", intro: sc ? undefined : "Tell us what you need and we’ll get back to you with a quote." }] : []),
  ];
  return {
    enabled: true,
    title: bp.business.name,
    description: `${bp.business.name}: ${tagline(bp)}`.slice(0, 200),
    sections,
    ...(contact ? { contact } : {}),
  };
}
