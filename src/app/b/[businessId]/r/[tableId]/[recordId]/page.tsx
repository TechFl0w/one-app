import { withComputed } from "@/engine/computed";
import { getBusinessContext, getDevice } from "@/server/context";
import { supabaseStore } from "@/server/store";
import { RecordPageView } from "@/components/page/RecordPageView";
import { submitRecordForm } from "../../../actions";
import { sandboxCreate, sandboxGet, sandboxList, sandboxFileUrl, sandboxRemove, sandboxUpdate, sandboxUploadTarget } from "../../../sandbox-actions";

/** A record's own page (docs: record pages). */
export default async function RecordPage({ params }: PageProps<"/b/[businessId]/r/[tableId]/[recordId]">) {
  const { businessId, tableId, recordId } = await params;
  const [{ blueprint, userId, supabase }, device] = await Promise.all([getBusinessContext(businessId), getDevice()]);
  return (
    <RecordPageView
      tableId={tableId}
      recordId={recordId}
      device={device}
      userId={userId}
      env={{
        blueprint,
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
          },
        },
      }}
    />
  );
}
