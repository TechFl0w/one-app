import { notFound } from "next/navigation";
import { getBusinessContext, getDevice } from "@/server/context";
import { supabaseStore } from "@/server/store";
import { PageView } from "@/components/page/PageView";
import { submitRecordForm } from "../../actions";

export default async function BusinessPage({ params }: PageProps<"/b/[businessId]/p/[pageId]">) {
  const { businessId, pageId } = await params;
  const [{ blueprint, userId, supabase }, device] = await Promise.all([getBusinessContext(businessId), getDevice()]);
  const page = blueprint.pages.find((p) => p.id === pageId);
  if (!page) notFound();
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
