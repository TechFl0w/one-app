import { getBusinessContext, getDevice } from "@/server/context";
import { supabaseStore } from "@/server/store";
import { PageView } from "@/components/page/PageView";
import { EditablePage } from "@/components/page/EditablePage";
import { submitRecordForm } from "../../actions";

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
        blueprint,
        store: supabaseStore(supabase, businessId),
        formAction: (tableId, fields) => submitRecordForm.bind(null, businessId, tableId, fields),
      }}
    />
  );
}
