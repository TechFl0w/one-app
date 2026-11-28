import { withComputed } from "@/engine/computed";
import { getBusinessContext, getDevice } from "@/server/context";
import { supabaseStore } from "@/server/store";
import { getAccount } from "@/server/payments";
import { RecordPageView } from "@/components/page/RecordPageView";
import { submitRecordForm } from "../../../actions";
import { sandboxCreate, sandboxGet, sandboxList, sandboxFileUrl, sandboxSendDocument, sandboxDocumentLink, sandboxInvoiceFromQuote, sandboxInvoiceWork, sandboxFreeTimes, sandboxBookTime, sandboxRemove, sandboxUpdate, sandboxUploadTarget } from "../../../sandbox-actions";

/** A record's own page (docs: record pages). */
export default async function RecordPage({ params, searchParams }: PageProps<"/b/[businessId]/r/[tableId]/[recordId]">) {
  const { businessId, tableId, recordId } = await params;
  const [{ blueprint, userId, supabase }, device] = await Promise.all([getBusinessContext(businessId), getDevice()]);
  const hasInvoices = blueprint.documents?.some((d) => d.kind === "invoice" && d.table === tableId);
  const account = hasInvoices ? await getAccount(supabase, businessId).catch(() => null) : null;
  return (
    <RecordPageView
      tableId={tableId}
      recordId={recordId}
      device={device}
      userId={userId}
      env={{
        params: await searchParams,
        blueprint,
        ...(hasInvoices ? { payments: { ready: !!account?.chargesEnabled, settingsHref: `/b/${businessId}/settings/payments` } } : {}),
        store: withComputed(supabaseStore(supabase, businessId), blueprint),
        formAction: (t, fields) => submitRecordForm.bind(null, businessId, t, fields),
        sandbox: {
          basePath: `/b/${businessId}`,
          bridge: {
            list: sandboxList.bind(null, businessId),
            get: sandboxGet.bind(null, businessId),
            create: sandboxCreate.bind(null, businessId),
            update: sandboxUpdate.bind(null, businessId),
            remove: sandboxRemove.bind(null, businessId),
            uploadTarget: sandboxUploadTarget.bind(null, businessId),
            fileUrl: sandboxFileUrl.bind(null, businessId),
            sendDocument: sandboxSendDocument.bind(null, businessId),
            documentLink: sandboxDocumentLink.bind(null, businessId),
            invoiceFromQuote: sandboxInvoiceFromQuote.bind(null, businessId),
            invoiceWork: sandboxInvoiceWork.bind(null, businessId),
            freeTimes: sandboxFreeTimes.bind(null, businessId),
            bookTime: sandboxBookTime.bind(null, businessId),
          },
        },
      }}
    />
  );
}
