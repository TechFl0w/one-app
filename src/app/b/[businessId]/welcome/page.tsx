import Link from "next/link";
import { revalidatePath } from "next/cache";
import { ArrowRight, CalendarDays, Check, CreditCard, Globe, PartyPopper } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { getAccount, stripeConfigured } from "@/server/payments";
import { bookingPageUrl, ensureBookingPage } from "@/server/bookingPage";
import { PaymentsSettings } from "@/components/payments/PaymentsSettings";
import { ShareBookingLink } from "@/components/booking/ShareBookingLink";
import { defaultSite } from "@/engine/site";
import { paymentsOnboardingSecret, refreshPaymentsStatus, saveDepositRule } from "../payment-actions";

/**
 * Right after the app is built: the few things that make it work for real, in order — get paid
 * online (Stripe, right here), share the booking page or website, see bookings in your calendar.
 * The menu's "Finish setting up" comes back here until they're done.
 */
export default async function WelcomePage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { supabase, blueprint: bp } = await getBusinessContext(businessId);
  const base = `/b/${businessId}`;
  const [acct, page] = await Promise.all([getAccount(supabase, businessId).catch(() => null), ensureBookingPage(supabase, businessId, bp.business.name).catch(() => null)]);
  const sc = bp.scheduling;
  const invoices = bp.documents?.some((d) => d.kind === "invoice");
  const paid = !!acct?.chargesEnabled;
  const why = sc && invoices ? "Clients pay deposits when they book and pay invoices from the link you send." : sc ? "Clients pay a deposit when they book online, so fewer no-shows." : invoices ? "Clients pay your invoices by card from the link you send — no more chasing." : "Send payment links and take card payments.";

  async function makeSite() {
    "use server";
    const { createClient } = await import("@/lib/supabase/server");
    const { commitChangeSet, getCurrentBlueprint } = await import("@/server/blueprints");
    const db = await createClient();
    const cur = await getCurrentBlueprint(db, businessId);
    if (!cur.site) await commitChangeSet(db, businessId, { baseVersion: cur.version, source: "ui", summary: "Make the website", ops: [{ op: "setSite", site: defaultSite(cur) }] });
    revalidatePath(`${base}/welcome`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="mb-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-accent"><PartyPopper className="h-4 w-4" /> Your app is ready</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Three things and you’re open for business</h1>
        <p className="mt-2 text-muted">Each takes a minute. You can do them later too — they wait under “Finish setting up” in the menu.</p>
      </div>

      <Step n={1} done={paid} icon={CreditCard} title="Get paid online">
        {paid ? (
          <p className="text-sm text-muted">Payments are on. {why}</p>
        ) : !stripeConfigured() ? (
          <p className="text-sm text-muted">Online payments aren’t switched on for this server yet.</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">{why} Money goes to your bank account; Stripe takes its usual card fee. Have your bank details and ID handy.</p>
            <PaymentsSettings
              publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null}
              status={{ connected: !!acct, chargesEnabled: !!acct?.chargesEnabled, payoutsEnabled: !!acct?.payoutsEnabled }}
              deposit={sc?.deposit ?? null}
              canHold={!!(sc?.statuses.held && sc.bookings.holdUntil)}
              getSecret={paymentsOnboardingSecret.bind(null, businessId)}
              refresh={refreshPaymentsStatus.bind(null, businessId)}
              saveDeposit={saveDepositRule.bind(null, businessId)}
            />
          </>
        )}
      </Step>

      {sc && page ? (
        <Step n={2} done={!!page.enabled} icon={Globe} title="Share your booking page">
          <p className="mb-3 text-sm text-muted">Put it in your Instagram bio, Google profile and WhatsApp. Clients pick a service, a time, and they’re booked.</p>
          <ShareBookingLink url={bookingPageUrl(page.slug)} />
        </Step>
      ) : (
        <Step n={2} done={!!bp.site} icon={Globe} title="Get a website">
          {bp.site && page ? (
            <p className="text-sm text-muted">Your website is ready. <Link className="font-semibold text-accent hover:underline" href={`${base}/settings/website`}>Edit it or share the link</Link>.</p>
          ) : (
            <form action={makeSite}>
              <p className="mb-3 text-sm text-muted">A one-page website made from your app — what you do, your prices, and a form that sends enquiries straight here.</p>
              <button className="btn-primary">Make my website</button>
            </form>
          )}
        </Step>
      )}

      <Step n={3} done={false} icon={CalendarDays} title="See your work in your own calendar">
        <p className="mb-3 text-sm text-muted">Subscribe once from Google, Apple or Outlook and {sc ? "bookings" : "your schedule"} show up next to your own appointments.</p>
        <Link className="btn-ghost" href={`${base}/settings/integrations`}>Get my calendar link</Link>
      </Step>

      <div className="flex justify-end pt-2">
        <Link href={base} className="btn-primary">Go to my app <ArrowRight className="h-4 w-4" /></Link>
      </div>
    </div>
  );
}

function Step({ n, done, icon: Icon, title, children }: { n: number; done: boolean; icon: typeof Check; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <div className="mb-3 flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-accent text-white" : "bg-accent-tint text-accent"}`}>{done ? <Check className="h-5 w-5" /> : n}</span>
        <h2 className="flex items-center gap-2 text-lg font-bold"><Icon className="h-5 w-5 text-accent" /> {title}</h2>
      </div>
      <div className="pl-12">{children}</div>
    </section>
  );
}
