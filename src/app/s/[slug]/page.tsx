import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { publicSite, signPhotos } from "@/server/site";
import { catalog as loadCatalog } from "@/booking/service";
import { SiteView } from "@/components/site/SiteView";
import { cssDeclarations, themeFontsHref, themeVars } from "@/theme/theme";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import { memoryBackend } from "@/agent/memoryBackend";
import { defaultSite, tagline } from "@/engine/site";
import { submitContact } from "./actions";
import type { Blueprint } from "@/schema/blueprint";

type Params = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  // /s/demo: the sample salon's site, made from its setup (nothing is saved).
  if (slug === "demo") {
    const bp: Blueprint = { ...demoBlueprint, business: { ...demoBlueprint.business, address: "2150 Main St, Vancouver, BC", phone: "604-555-0100" }, site: defaultSite(demoBlueprint) };
    return { blueprint: bp, businessId: "", slug, bookingOn: true, backend: memoryBackend({ blueprint: bp, records: demoRecords() }).backend, demo: true };
  }
  const s = await publicSite(slug);
  return s ? { ...s, demo: false } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const s = await load((await params).slug);
  if (!s) return {};
  const b = s.blueprint.business;
  return { title: s.blueprint.site?.title ?? b.name, description: s.blueprint.site?.description ?? `${b.name}: ${tagline(s.blueprint)}`, openGraph: { title: b.name, description: s.blueprint.site?.description } };
}

/** A business's public website (no account needed). */
export default async function SitePage({ params }: Params) {
  const { slug } = await params;
  const s = await load(slug);
  if (!s?.blueprint.site) notFound();
  const bp = s.blueprint;
  const site = bp.site!;
  const cat = bp.scheduling ? await loadCatalog(bp, s.backend).catch(() => null) : null;
  const photos = s.demo
    ? {}
    : await signPhotos(s.businessId, [
        bp.business.logo?.path,
        bp.business.cover?.path,
        ...site.sections.flatMap((x) => ("image" in x && x.image ? [x.image.path] : "images" in x ? x.images.map((i) => i.path) : [])),
        ...(cat?.services.map((x) => x.photo) ?? []),
        ...(cat?.practitioners.map((p) => p.photo) ?? []),
      ]);
  const priceField = bp.scheduling?.services.price && bp.tables.find((t) => t.id === bp.scheduling!.services.table)?.fields.find((f) => f.id === bp.scheduling!.services.price);
  const currency = (priceField && priceField.type === "money" && priceField.currency) || bp.business.currency || "CAD";
  const theme = bp.theme;
  const vars = themeVars(theme);
  const fonts = themeFontsHref(theme);
  // Search engines: the business, its address and phone, as structured data.
  const ld = { "@context": "https://schema.org", "@type": "LocalBusiness", name: bp.business.name, ...(bp.business.address ? { address: bp.business.address } : {}), ...(bp.business.phone ? { telephone: bp.business.phone } : {}) };
  return (
    <>
      {fonts && <link rel="stylesheet" href={fonts} />}
      {Object.keys(vars).length > 0 && <style>{`:root{${cssDeclarations(vars)}}`}</style>}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <SiteView bp={bp} sections={site.sections} catalog={cat} photos={photos} bookHref={s.bookingOn ? `/book/${slug}` : null} contact={site.contact ? submitContact.bind(null, slug) : null} currency={currency} />
    </>
  );
}
