import { CalendarCheck } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { ensureBookingPage, updateBookingPage } from "@/server/bookingPage";
import { revalidatePath } from "next/cache";

/** Owner settings for the public booking page: the link, on/off, a short intro. */
export default async function BookingSettingsPage({ params }: PageProps<"/b/[businessId]/settings/booking">) {
  const { businessId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const page = blueprint.scheduling ? await ensureBookingPage(supabase, businessId, blueprint.business.name).catch(() => null) : null;

  async function save(form: FormData) {
    "use server";
    const { createClient } = await import("@/lib/supabase/server");
    const intro = String(form.get("intro") ?? "").trim().slice(0, 500);
    await updateBookingPage(await createClient(), businessId, { enabled: form.get("enabled") === "on", intro: intro || null });
    revalidatePath(`/b/${businessId}/settings/booking`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <CalendarCheck className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Online booking</h1>
      </div>
      {!blueprint.scheduling ? (
        <div className="card p-8 text-sm text-muted">This business isn’t set up for bookings yet. Ask the assistant to add bookings, or start from the salon template.</div>
      ) : !page ? (
        <div className="card p-8 text-sm text-muted">Only owners and admins can change the booking page.</div>
      ) : (
        <form action={save} className="card space-y-5 p-6">
          <div>
            <p className="label">Your booking link</p>
            <a className="font-medium text-accent underline" href={`/book/${page.slug}`} target="_blank" rel="noreferrer">/book/{page.slug}</a>
            <p className="mt-1 text-xs text-muted">Share it on Instagram, Google or WhatsApp. Customers pick a service, a time and leave their details.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={page.enabled} className="h-4 w-4 accent-[var(--accent)]" />
            Accept online bookings
          </label>
          <div>
            <label className="label" htmlFor="intro">Short intro</label>
            <textarea id="intro" name="intro" className="input" rows={3} maxLength={500} defaultValue={page.intro ?? ""} placeholder="e.g. Please arrive 5 minutes early." />
          </div>
          <p className="text-xs text-muted">
            New bookings start as {blueprint.scheduling.rules.autoConfirm ? "confirmed" : "requests you approve"}; slots every {blueprint.scheduling.rules.slotStepMin} min, at least{" "}
            {Math.round(blueprint.scheduling.rules.minNoticeMin / 60)} h ahead, up to {blueprint.scheduling.rules.horizonDays} days out. Ask the assistant to change these.
          </p>
          <button className="btn-primary">Save</button>
        </form>
      )}
    </div>
  );
}
