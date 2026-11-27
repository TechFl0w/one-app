"use server";

import { publicSite } from "@/server/site";
import { RecordError } from "@/engine/records";

/** The website's contact form: adds the person to the business (a lead or client record). */
export async function submitContact(slug: string, _prev: { ok?: boolean; message?: string }, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  if (String(form.get("website") ?? "")) return { ok: true, message: "Thanks — we’ll be in touch." }; // honeypot
  if (slug === "demo") return { ok: true, message: "Thanks! (This is the sample salon — nothing was sent.)" };
  const s = await publicSite(slug);
  const c = s?.blueprint.site?.contact;
  if (!s || !c) return { message: "This form isn’t available right now." };
  const name = String(form.get("name") ?? "").trim().slice(0, 100);
  const email = String(form.get("email") ?? "").trim().slice(0, 200);
  const phone = String(form.get("phone") ?? "").trim().slice(0, 40);
  const message = String(form.get("message") ?? "").trim().slice(0, 2000);
  if (!name) return { message: "Please give your name." };
  if (!email && !phone) return { message: "Please give an email or phone number so we can reply." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { message: "That email address doesn’t look right." };
  const values: Record<string, unknown> = { [c.name]: name };
  if (c.email && email) values[c.email] = email;
  if (c.phone && phone) values[c.phone] = phone;
  if (c.message && message) values[c.message] = message;
  try {
    await s.backend.createRecord(c.table, values);
    return { ok: true, message: `Thanks, ${name.split(" ")[0]} — ${s.blueprint.business.name} will get back to you soon.` };
  } catch (e) {
    return { message: e instanceof RecordError ? e.message : "Something went wrong. Please try again." };
  }
}
