import { Globe } from "lucide-react";
import { revalidatePath } from "next/cache";
import { getBusinessContext } from "@/server/context";
import { ensureBookingPage } from "@/server/bookingPage";
import { ShareBookingLink } from "@/components/booking/ShareBookingLink";
import { defaultSite } from "@/engine/site";
import { SiteEditor } from "@/components/site/SiteEditor";
import { signPhotos } from "@/server/site";
import { siteImageTarget } from "./actions";

// Its own address (<slug>.oneapp.site) once SITE_DOMAIN is set up, else a path on the app.
const siteUrl = (slug: string) => (process.env.SITE_DOMAIN ? `https://${slug}.${process.env.SITE_DOMAIN}` : `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/s/${slug}`);

/** The business's public website: make it, publish it, share it; address and phone for it. */
export default async function WebsiteSettingsPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const page = await ensureBookingPage(supabase, businessId, blueprint.business.name).catch(() => null);
  const site = blueprint.site;
  const photos = site ? await signPhotos(businessId, site.sections.flatMap((x) => ("image" in x && x.image ? [x.image.path] : "images" in x ? x.images.map((i) => i.path) : []))) : {};

  async function save(form: FormData) {
    "use server";
    const { createClient } = await import("@/lib/supabase/server");
    const { commitChangeSet, getCurrentBlueprint } = await import("@/server/blueprints");
    const db = await createClient();
    const bp = await getCurrentBlueprint(db, businessId);
    const intent = String(form.get("intent") ?? "save");
    const address = String(form.get("address") ?? "").trim().slice(0, 300);
    const phone = String(form.get("phone") ?? "").trim().slice(0, 40);
    const ops = [];
    if (address !== (bp.business.address ?? "") || phone !== (bp.business.phone ?? "")) {
      ops.push({ op: "updateBusiness" as const, business: { ...(address ? { address } : {}), ...(phone ? { phone } : {}) } });
    }
    if (intent === "make") ops.push({ op: "setSite" as const, site: defaultSite({ ...bp, business: { ...bp.business, ...(address ? { address } : {}), ...(phone ? { phone } : {}) } }) });
    else if (bp.site) {
      const enabled = form.get("enabled") === "on";
      if (enabled !== bp.site.enabled) ops.push({ op: "setSite" as const, site: { ...bp.site, enabled } });
    }
    if (ops.length) await commitChangeSet(db, businessId, { baseVersion: bp.version, source: "ui", summary: intent === "make" ? "Make the website" : "Website settings", ops });
    revalidatePath(`/b/${businessId}`, "layout");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-2 flex items-center gap-3">
        <Globe className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Website</h1>
      </div>
      <p className="mb-6 text-sm text-muted">A one-page website made from your app: services and prices, team, opening hours, booking and a contact form. Change a price in the app and it changes on the site.</p>
      {!page ? (
        <div className="card p-8 text-sm text-muted">Only owners and admins can change the website.</div>
      ) : (
        <form action={save} className="card space-y-5 p-6">
          {site ? (
            <>
              <div>
                <p className="label">Your website</p>
                <ShareBookingLink url={siteUrl(page.slug)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="enabled" defaultChecked={site.enabled} className="h-4 w-4 accent-[var(--accent)]" />
                Published (anyone with the link can see it)
              </label>
              <p className="rounded-xl bg-ground px-4 py-3 text-sm text-muted">
                Edit the words and photos below, or ask the assistant — “make the hero photo the grooming table”, “add a winter special banner”.
              </p>
            </>
          ) : (
            <p className="text-sm">You don’t have a website yet. We’ll make the first version from your setup — you can change everything after.</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="address">Address</label>
              <input id="address" name="address" className="input" defaultValue={blueprint.business.address ?? ""} placeholder="2150 Main St, Vancouver, BC" />
            </div>
            <div>
              <label className="label" htmlFor="phone">Phone</label>
              <input id="phone" name="phone" type="tel" className="input" defaultValue={blueprint.business.phone ?? ""} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {site ? (
              <>
                <button className="btn-primary" name="intent" value="save">Save</button>
                <a className="btn-ghost" href={`/s/${page.slug}`} target="_blank" rel="noopener noreferrer">Open the website</a>
              </>
            ) : (
              <button className="btn-primary" name="intent" value="make">Make my website</button>
            )}
          </div>
        </form>
      )}
      {page && site && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Sections</h2>
          <SiteEditor site={site} upload={siteImageTarget.bind(null, businessId)} photos={photos} />
        </section>
      )}
    </div>
  );
}
