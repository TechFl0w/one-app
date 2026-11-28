import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { managedBooking } from "@/server/bookingLinks";
import { publicBooking } from "@/server/bookingPage";
import { cssDeclarations, themeFontsHref, themeVars } from "@/theme/theme";
import { ManageBooking } from "@/components/booking/ManageBooking";
import { cancelBooking } from "./actions";

export const metadata: Metadata = { title: "Your booking", robots: { index: false } };

/** A client's own booking, from the link in their confirmation: details, calendar, cancel. */
export default async function ManageBookingPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const [booking, info] = await Promise.all([managedBooking(token), publicBooking(slug)]);
  if (!booking) notFound();
  const theme = info?.blueprint.theme;
  const vars = themeVars(theme);
  const fonts = themeFontsHref(theme);
  return (
    <main className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
      {fonts && <link rel="stylesheet" href={fonts} />}
      {Object.keys(vars).length > 0 && <style>{`:root{${cssDeclarations(vars)}}`}</style>}
      <ManageBooking booking={booking} bookAgain={info ? `/book/${slug}` : null} cancel={cancelBooking.bind(null, slug, token)} />
    </main>
  );
}
