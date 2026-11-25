import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OwnerBackend } from "@/agent/types";
import { ChangeSetError, previewChangeSet } from "@/engine/changeSet";
import { errorResult, okResult } from "@/engine/commit";
import { riskyOps } from "@/engine/editing";
import { commitChangeSet, getCurrentBlueprint } from "./blueprints";
import { createCheckout, refundPayment, stripeConfigured } from "./payments";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRecord, deleteRecord, getRecord, listRecords, updateRecord } from "./records";

async function requireManager(supabase: SupabaseClient, businessId: string) {
  const { data: claims } = await supabase.auth.getClaims();
  const uid = (claims?.claims.sub as string | undefined) ?? "";
  const { data } = await supabase.from("memberships").select("role").eq("business_id", businessId).eq("user_id", uid).maybeSingle();
  if (!data || !["owner", "admin"].includes(data.role)) throw new Error("Only owners and admins can handle payments");
}

/**
 * OwnerBackend for a real business, acting as the signed-in user (RLS applies to every call).
 * With a service-role client (customer agent, MCP), every call is still scoped by businessId and
 * `verifiedManager` says the caller's owner/admin role was already checked.
 */
export function supabaseOwnerBackend(supabase: SupabaseClient, businessId: string, opts: { verifiedManager?: boolean } = {}): OwnerBackend {
  const manager = () => (opts.verifiedManager ? Promise.resolve() : requireManager(supabase, businessId));
  return {
    blueprint: () => getCurrentBlueprint(supabase, businessId),
    query: (q) => listRecords(supabase, businessId, q),
    getRecord: (t, id) => getRecord(supabase, businessId, t, id),
    createRecord: (t, input) => createRecord(supabase, businessId, t, input),
    updateRecord: (t, id, input, opts) => updateRecord(supabase, businessId, t, id, input, opts),
    deleteRecord: (t, id) => deleteRecord(supabase, businessId, t, id, { confirmed: true }),
    payments: stripeConfigured()
      ? {
          // Payment rows and Stripe calls need the service role; only owners/admins get here.
          async createLink(input) {
            await manager();
            return createCheckout(createAdminClient(), {
              ...input,
              businessId,
              successUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/paid`,
              cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/paid?cancelled=1`,
              customerEmail: input.email,
            });
          },
          async list(limit) {
            const { data } = await supabase.from("payments").select("id, kind, amount, currency, description, status, created_at, record_id").eq("business_id", businessId).order("created_at", { ascending: false }).limit(limit);
            return (data ?? []).map((p) => ({ ...p, amount: Number(p.amount) }));
          },
          async refund(paymentId) {
            await manager();
            await refundPayment(createAdminClient(), businessId, paymentId);
          },
        }
      : undefined,
    async commitChangeSet(cs, confirmed) {
      try {
        const current = await getCurrentBlueprint(supabase, businessId);
        const p = previewChangeSet(current, cs);
        if (p.ok && p.requiresConfirmation && !confirmed) {
          return errorResult(new ChangeSetError("needs_confirmation", "Needs confirmation"), riskyOps(p));
        }
        const r = await commitChangeSet(supabase, businessId, cs, { confirmed });
        return okResult(r, { historyId: r.historyId });
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}
