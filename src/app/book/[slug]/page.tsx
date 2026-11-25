import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking/BookingFlow";
import { loadCatalog } from "./actions";
import { publicBooking } from "@/server/bookingPage";
import { demoBlueprint } from "@/demo/salon";
import { cssDeclarations, themeFontsHref, themeVars } from "@/theme/theme";

export const metadata: Metadata = { title: "Book an appointment" };

/** Public booking page (no account needed). /book/demo is the sample salon. */
export default async function BookPage({ params, searchParams }: PageProps<"/book/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const returned = sp.paid ? "paid" : sp.cancelled ? "cancelled" : undefined;
  const catalog = await loadCatalog(slug).catch(() => null);
  if (!catalog) notFound();
  const info = slug === "demo" ? { blueprint: demoBlueprint, page: { intro: "Sample salon — try booking, nothing is saved." } } : await publicBooking(slug);
  const sc = info?.blueprint.scheduling;
  const priceField = sc?.services.price && info?.blueprint.tables.find((t) => t.id === sc.services.table)?.fields.find((f) => f.id === sc.services.price);
  const currency = priceField && priceField.type === "money" ? priceField.currency : undefined;
  // The business's own look (colours, fonts, shape), like inside its app.
  const theme = info?.blueprint.theme;
  const vars = themeVars(theme);
  const fonts = themeFontsHref(theme);
  return (
    <main className="flex flex-1 items-start justify-center px-4 py-10 sm:px-8 sm:py-16">
      {fonts && <link rel="stylesheet" href={fonts} />}
      {Object.keys(vars).length > 0 && <style>{`:root{${cssDeclarations(vars)}}`}</style>}
      <BookingFlow slug={slug} catalog={catalog} currency={currency ?? "CAD"} intro={info?.page.intro} returned={returned} />
    </main>
  );
}
