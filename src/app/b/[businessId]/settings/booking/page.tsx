import { CalendarCheck } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { bookingPageUrl, ensureBookingPage, updateBookingPage } from "@/server/bookingPage";
import { ShareBookingLink } from "@/components/booking/ShareBookingLink";
import { revalidatePath } from "next/cache";

/** Owner settings for the public booking page: the link, on/off, a short intro. */
export default async function BookingSettingsPage({ params }: PageProps<"/b/[businessId]/settings/booking">) {
  const { businessId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const page = blueprint.scheduling ? await ensureBookingPage(supabase, businessId, blueprint.business.name).catch(() => null) : null;

  async function save(form: FormData) {
    "use server";
    const { createClient } = await import("@/lib/supabase/server");
    const { commitChangeSet, getCurrentBlueprint } = await import("@/server/blueprints");
    const db = await createClient();
    const intro = String(form.get("intro") ?? "").trim().slice(0, 500);
    await updateBookingPage(db, businessId, { enabled: form.get("enabled") === "on", intro: intro || null });
    // The review link is part of the setup (used by review-request messages).
    const reviewUrl = String(form.get("review_url") ?? "").trim();
    const bp = await getCurrentBlueprint(db, businessId);
    if (/^https:\/\/\S+$/.test(reviewUrl) && reviewUrl !== bp.business.reviewUrl) {
      await commitChangeSet(db, businessId, { baseVersion: bp.version, source: "ui", summary: "Set review link", ops: [{ op: "updateBusiness", business: { reviewUrl } }] });
    }
    revalidatePath(`/b/${businessId}`, "layout");
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
            <ShareBookingLink url={bookingPageUrl(page.slug)} />
            <p className="mt-2 text-xs text-muted">Share it on Instagram, Google or WhatsApp. Customers pick a service, a time and leave their details.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={page.enabled} className="h-4 w-4 accent-[var(--accent)]" />
            Accept online bookings
          </label>
          <div>
            <label className="label" htmlFor="intro">Short intro</label>
            <textarea id="intro" name="intro" className="input" rows={3} maxLength={500} defaultValue={page.intro ?? ""} placeholder="e.g. Please arrive 5 minutes early." />
          </div>
          <div>
            <label className="label" htmlFor="review_url">Review link</label>
            <input id="review_url" name="review_url" type="url" pattern="https://.*" className="input" defaultValue={blueprint.business.reviewUrl ?? ""} placeholder="https://g.page/r/…/review" />
            <p className="mt-1 text-xs text-muted">Review requests send happy clients here (for example your Google review link). Reminders and follow-ups are on the Automations page.</p>
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
