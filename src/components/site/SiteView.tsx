import { CalendarCheck, Clock, MapPin, Phone, Quote, Star } from "lucide-react";
import type { Blueprint, SiteSection, WeeklyHours } from "@/schema/blueprint";
import type { Catalog } from "@/booking/service";
import { iconFor, initials, moneyFmt } from "@/components/booking/parts";
import { ContactForm } from "./ContactForm";

const DAYS: [keyof WeeklyHours, string][] = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: m ? "2-digit" : undefined, timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, h, m)));
};

/**
 * A business's public website: its sections top to bottom, in its theme. Services, team and
 * hours come from the app's own data; booking links to the booking page; the contact form adds
 * a lead. Phones first.
 */
export function SiteView({ bp, sections, catalog, photos, bookHref, contact, currency }: { bp: Blueprint; sections: SiteSection[]; catalog: Catalog | null; photos: Record<string, string>; bookHref: string | null; contact: ((prev: { ok?: boolean; message?: string }, form: FormData) => Promise<{ ok?: boolean; message?: string }>) | null; currency: string }) {
  const money = moneyFmt(currency);
  const b = bp.business;
  const phoneHref = b.phone ? `tel:${b.phone.replace(/[^+\d]/g, "")}` : null;
  const cta = (kind: "book" | "contact" | "call" | undefined, light = false) => {
    const cls = light ? "btn bg-white px-6 py-3 text-base text-ink hover:bg-white/90" : "btn-primary px-6 py-3 text-base";
    if (kind === "book" && bookHref) return <a href={bookHref} className={cls}><CalendarCheck className="h-5 w-5" /> Book online</a>;
    if (kind === "call" && phoneHref) return <a href={phoneHref} className={cls}><Phone className="h-5 w-5" /> Call us</a>;
    if (kind === "contact" && contact) return <a href="#contact" className={cls}>Get in touch</a>;
    return null;
  };
  const img = (p?: { path: string }) => (p ? photos[p.path] : undefined);

  return (
    <div className="min-h-screen bg-[var(--ground)] text-ink">
      <nav className="sticky top-0 z-30 border-b border-line/70 bg-[var(--ground)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent text-sm font-extrabold text-white">
            {b.logo && photos[b.logo.path] ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
              <img src={photos[b.logo.path]} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(b.name)
            )}
          </span>
          <span className="truncate font-extrabold tracking-tight">{b.name}</span>
          <span className="ml-auto flex items-center gap-2">
            {phoneHref && <a href={phoneHref} className="hidden rounded-full px-3 py-2 text-sm font-semibold hover:bg-card sm:inline-flex">{b.phone}</a>}
            {bookHref ? <a href={bookHref} className="btn-primary px-4 py-2">Book</a> : contact ? <a href="#contact" className="btn-primary px-4 py-2">Contact</a> : null}
          </span>
        </div>
      </nav>

      {sections.map((s) => {
        switch (s.type) {
          case "hero": {
            const pic = img(s.image) ?? (b.cover ? photos[b.cover.path] : undefined);
            return (
              <header key={s.id} className="relative overflow-hidden">
                {pic ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                  <img src={pic} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 15% 20%, color-mix(in srgb, var(--accent) 35%, white), transparent 55%), linear-gradient(135deg, var(--accent), var(--accent-hover))" }} />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/20 to-black/5" />
                <div className="relative mx-auto flex min-h-[62vh] max-w-6xl flex-col justify-end px-4 pb-14 pt-24 text-white sm:px-6 sm:pb-20">
                  <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">{s.title ?? b.name}</h1>
                  {s.subtitle && <p className="mt-4 max-w-xl text-lg text-white/85 sm:text-xl">{s.subtitle}</p>}
                  <div className="mt-8 flex flex-wrap gap-3">
                    {cta(s.cta, true)}
                    {b.address && (
                      <a href={`https://maps.google.com/?q=${encodeURIComponent(b.address)}`} target="_blank" rel="noopener noreferrer" className="btn border border-white/40 px-5 py-3 text-base text-white hover:bg-white/10">
                        <MapPin className="h-5 w-5" /> Directions
                      </a>
                    )}
                  </div>
                </div>
              </header>
            );
          }
          case "banner":
            return (
              <div key={s.id} className={`px-4 py-3 text-center text-sm font-semibold sm:text-base ${s.tone === "amber" ? "bg-amber-100 text-amber-900" : s.tone === "neutral" ? "bg-card text-ink" : "bg-accent text-white"}`}>
                {s.text}
              </div>
            );
          case "services": {
            const list = catalog?.services ?? [];
            if (!list.length) return null;
            const groups = [...new Set(list.map((x) => x.category ?? ""))];
            return (
              <Section key={s.id} id="services" title={s.title ?? "Services"} intro={s.intro}>
                <div className="space-y-10">
                  {groups.map((g) => (
                    <div key={g || "all"}>
                      {g && groups.length > 1 && <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-accent">{g}</h3>}
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {list.filter((x) => (x.category ?? "") === g).map((x) => {
                          const Icon = iconFor(x.name);
                          const prices = [x.price, ...Object.values(x.variants ?? {}).map((v) => v.price)].filter((p): p is number => p != null);
                          return (
                            <div key={x.id} className="card flex gap-4 p-5">
                              {x.photo && photos[x.photo] ? (
                                // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                                <img src={photos[x.photo]} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
                              ) : (
                                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent-tint text-accent"><Icon className="h-7 w-7" /></span>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-3">
                                  <p className="font-bold leading-snug">{x.name}</p>
                                  {prices.length > 0 && <p className="shrink-0 font-bold tabular-nums">{new Set(prices).size > 1 ? "from " : ""}{money(Math.min(...prices))}</p>}
                                </div>
                                {x.description && <p className="mt-1 text-sm text-muted">{x.description}</p>}
                                <p className="mt-1 flex items-center gap-1 text-sm text-muted"><Clock className="h-3.5 w-3.5" /> {x.durationMin} min</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                {bookHref && <div className="mt-8">{cta("book")}</div>}
              </Section>
            );
          }
          case "team": {
            const people = catalog?.practitioners ?? [];
            if (!people.length) return null;
            return (
              <Section key={s.id} title={s.title ?? "Our team"} intro={s.intro}>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {people.map((p) => (
                    <div key={p.id} className="card overflow-hidden text-center">
                      {p.photo && photos[p.photo] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                        <img src={photos[p.photo]} alt="" className="aspect-square w-full object-cover" />
                      ) : (
                        <div className="flex aspect-square w-full items-center justify-center bg-accent-tint text-4xl font-extrabold text-accent">{initials(p.name)}</div>
                      )}
                      <p className="p-4 font-bold">{p.name}</p>
                    </div>
                  ))}
                </div>
              </Section>
            );
          }
          case "about": {
            const pic = img(s.image);
            return (
              <Section key={s.id} title={s.title ?? "About us"}>
                <div className={`grid items-center gap-8 ${pic ? "md:grid-cols-2" : ""}`}>
                  <p className="whitespace-pre-line text-lg leading-relaxed text-muted">{s.text}</p>
                  {pic && (
                    // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                    <img src={pic} alt="" className="aspect-[4/3] w-full rounded-card object-cover" />
                  )}
                </div>
              </Section>
            );
          }
          case "gallery": {
            const pics = s.images.map(img).filter((u): u is string => !!u);
            if (!pics.length) return null;
            return (
              <Section key={s.id} title={s.title ?? "Our work"}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
                  {pics.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                    <img key={i} src={u} alt="" loading="lazy" className={`w-full rounded-2xl object-cover ${i === 0 ? "col-span-2 row-span-2 aspect-square" : "aspect-square"}`} />
                  ))}
                </div>
              </Section>
            );
          }
          case "reviews":
            return (
              <Section key={s.id} title={s.title ?? "What clients say"}>
                <div className="grid gap-4 md:grid-cols-3">
                  {s.quotes.map((q, i) => (
                    <figure key={i} className="card p-6">
                      <div className="mb-3 flex gap-0.5 text-accent">{Array.from({ length: 5 }, (_, k) => <Star key={k} className="h-4 w-4" fill="currentColor" />)}</div>
                      <Quote className="h-5 w-5 text-muted/40" />
                      <blockquote className="mt-1 leading-relaxed">{q.text}</blockquote>
                      <figcaption className="mt-4 text-sm font-semibold text-muted">— {q.name}</figcaption>
                    </figure>
                  ))}
                </div>
                {s.link && b.reviewUrl && <a href={b.reviewUrl} target="_blank" rel="noopener noreferrer" className="mt-6 inline-block font-semibold text-accent hover:underline">Read more reviews</a>}
              </Section>
            );
          case "hours": {
            const hours = bp.scheduling?.hours;
            return (
              <Section key={s.id} id="visit" title={s.title ?? "Visit us"}>
                <div className="grid gap-6 md:grid-cols-2">
                  {hours && (
                    <div className="card p-6">
                      <p className="mb-3 flex items-center gap-2 font-bold"><Clock className="h-5 w-5 text-accent" /> Opening hours</p>
                      <dl className="divide-y divide-line text-sm">
                        {DAYS.map(([d, label]) => (
                          <div key={d} className="flex justify-between py-2">
                            <dt className="text-muted">{label}</dt>
                            <dd className="font-medium tabular-nums">{hours[d]?.length ? hours[d]!.map(([a, z]) => `${hm(a)}–${hm(z)}`).join(", ") : "Closed"}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                  <div className="card flex flex-col gap-3 p-6">
                    {b.address && (
                      <a href={`https://maps.google.com/?q=${encodeURIComponent(b.address)}`} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 font-semibold hover:underline">
                        <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-accent" /> {b.address}
                      </a>
                    )}
                    {phoneHref && <a href={phoneHref} className="flex items-center gap-2 font-semibold hover:underline"><Phone className="h-5 w-5 text-accent" /> {b.phone}</a>}
                    {!b.address && !phoneHref && <p className="text-sm text-muted">Get in touch below.</p>}
                    {bookHref && <div className="mt-auto pt-3">{cta("book")}</div>}
                  </div>
                </div>
              </Section>
            );
          }
          case "contact":
            return contact ? (
              <Section key={s.id} id="contact" title={s.title ?? "Get in touch"} intro={s.intro}>
                <ContactForm action={contact} />
              </Section>
            ) : null;
        }
      })}

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-8 text-sm text-muted sm:px-6">
          <span className="font-semibold text-ink">{b.name}</span>
          {b.address && <span>{b.address}</span>}
          {b.phone && <span>{b.phone}</span>}
          <span className="ml-auto">© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}

function Section({ id, title, intro, children }: { id?: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
        {intro && <p className="mt-3 max-w-2xl text-lg text-muted">{intro}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}
