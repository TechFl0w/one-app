import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookingFlow, type Shop } from "@/components/booking/BookingFlow";
import { loadCatalog } from "./actions";
import { publicBooking } from "@/server/bookingPage";
import { demoBlueprint } from "@/demo/salon";
import { cssDeclarations, themeFontsHref, themeVars } from "@/theme/theme";
import { createAdminClient } from "@/lib/supabase/admin";
import { FILES_BUCKET, isBusinessFilePath } from "@/lib/files";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const info = slug === "demo" ? { blueprint: demoBlueprint } : await publicBooking(slug);
  const name = info?.blueprint.business.name;
  return { title: name ? `Book with ${name}` : "Book an appointment", description: name ? `Book online with ${name}: pick a service and a time that suits you.` : undefined };
}

/** Public booking page (no account needed). /book/demo is the sample salon. */
export default async function BookPage({ params, searchParams }: PageProps<"/book/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const returned = sp.paid ? "paid" : sp.cancelled ? "cancelled" : undefined;
  const catalog = await loadCatalog(slug).catch(() => null);
  if (!catalog) notFound();
  const real = slug === "demo" ? null : await publicBooking(slug);
  const info = real ?? { blueprint: demoBlueprint, page: { intro: "Sample salon — try booking, nothing is saved.", businessId: "" } };
  const bp = info.blueprint;
  const sc = bp.scheduling;
  const priceField = sc?.services.price && bp.tables.find((t) => t.id === sc.services.table)?.fields.find((f) => f.id === sc.services.price);
  const currency = priceField && priceField.type === "money" ? priceField.currency : undefined;

  // Photos (logo, cover, services, staff) live in the business's private storage: sign them.
  const paths = [bp.business.logo?.path, bp.business.cover?.path, ...catalog.services.map((s) => s.photo), ...catalog.practitioners.map((p) => p.photo)].filter(
    (p): p is string => !!p && !!real && isBusinessFilePath(real.page.businessId, p),
  );
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await createAdminClient("public").storage.from(FILES_BUCKET).createSignedUrls([...new Set(paths)], 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }
  const shop: Shop = {
    name: bp.business.name,
    intro: info.page.intro ?? null,
    address: bp.business.address ?? null,
    phone: bp.business.phone ?? null,
    logo: bp.business.logo ? urls.get(bp.business.logo.path) ?? null : null,
    cover: bp.business.cover ? urls.get(bp.business.cover.path) ?? null : null,
    hours: sc?.hours ?? {},
    photos: Object.fromEntries(urls),
  };
  const theme = bp.theme;
  const vars = themeVars(theme);
  const fonts = themeFontsHref(theme);
  return (
    <main className="flex flex-1 justify-center">
      {fonts && <link rel="stylesheet" href={fonts} />}
      {Object.keys(vars).length > 0 && <style>{`:root{${cssDeclarations(vars)}}`}</style>}
      <BookingFlow slug={slug} catalog={catalog} shop={shop} currency={currency ?? bp.business.currency ?? "CAD"} returned={returned} />
    </main>
  );
}
