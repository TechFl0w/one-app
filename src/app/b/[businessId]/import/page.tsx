import { FileSpreadsheet } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { ImportWizard } from "@/components/import/ImportWizard";
import { importSpreadsheet } from "../import-actions";

export default async function ImportPage({ params }: PageProps<"/b/[businessId]/import">) {
  const { businessId } = await params;
  const { blueprint } = await getBusinessContext(businessId);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <FileSpreadsheet className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Import a spreadsheet</h1>
      </div>
      <ImportWizard tables={blueprint.tables} basePath={`/b/${businessId}`} run={importSpreadsheet.bind(null, businessId)} />
    </div>
  );
}
