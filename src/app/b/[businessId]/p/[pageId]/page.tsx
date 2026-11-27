import { withComputed } from "@/engine/computed";
import { getBusinessContext, getDevice } from "@/server/context";
import { supabaseStore } from "@/server/store";
import { PageView } from "@/components/page/PageView";
import { EditablePage } from "@/components/page/EditablePage";
import { submitRecordForm } from "../../actions";
import { sandboxCreate, sandboxGet, sandboxList, sandboxFileUrl, sandboxSendDocument, sandboxDocumentLink, sandboxInvoiceFromQuote, sandboxInvoiceWork, sandboxFreeTimes, sandboxBookTime, sandboxRemove, sandboxUpdate, sandboxUploadTarget } from "../../sandbox-actions";

export default async function BusinessPage({ params }: PageProps<"/b/[businessId]/p/[pageId]">) {
  const { businessId, pageId } = await params;
  const [{ blueprint, userId, supabase }, device] = await Promise.all([getBusinessContext(businessId), getDevice()]);
  const page = blueprint.pages.find((p) => p.id === pageId);
  // A page only in the unsaved Edit-mode draft (or removed) is resolved on the client.
  if (!page) return <EditablePage pageId={pageId} device={device} userId={userId} rendered={{}} />;
  return (
    <PageView
      page={page}
      device={device}
      userId={userId}
      env={{
        // Used on the server only (BlockView renders each screen with its own code).
        blueprint,
        store: withComputed(supabaseStore(supabase, businessId), blueprint),
        formAction: (tableId, fields) => submitRecordForm.bind(null, businessId, tableId, fields),
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
