import { CreditCard } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { getAccount } from "@/server/payments";
import { PaymentsSettings } from "@/components/payments/PaymentsSettings";
import { paymentsOnboardingSecret, refreshPaymentsStatus, saveDepositRule } from "../../payment-actions";

export default async function PaymentsSettingsPage({ params }: PageProps<"/b/[businessId]/settings/payments">) {
  const { businessId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const acct = await getAccount(supabase, businessId).catch(() => null);
  const sc = blueprint.scheduling;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <CreditCard className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
      </div>
      <PaymentsSettings
        publishableKey={process.env.STRIPE_SECRET_KEY ? (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null) : null}
        status={{ connected: !!acct, chargesEnabled: !!acct?.chargesEnabled, payoutsEnabled: !!acct?.payoutsEnabled }}
        deposit={sc?.deposit ?? null}
        canHold={!!(sc?.statuses.held && sc.bookings.holdUntil)}
        getSecret={paymentsOnboardingSecret.bind(null, businessId)}
        refresh={refreshPaymentsStatus.bind(null, businessId)}
        saveDeposit={saveDepositRule.bind(null, businessId)}
      />
    </div>
  );
}
