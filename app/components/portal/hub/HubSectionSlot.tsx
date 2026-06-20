/**
 * Active Hub section body (decision B/C) for the unified client-portal Hub.
 *
 * Extracted verbatim from app/routes/public/portal-inspection.tsx (behavior-
 * preserving). Overview renders the status cards inside the Hub itself; this slot
 * is only used on non-overview tabs. Presentational + props-threaded: the route
 * owns the loader data, the document upload/delete handlers, and the docs UI
 * state, and passes them in.
 */
import type React from "react";
import type { HubSection } from "~/components/portal/InspectionHub";
import DocumentsSection, {
  type DocumentItem,
  type DocumentCategory,
  type DocumentVisibility,
} from "~/components/DocumentsSection";
import { ReportView, reportViewProps } from "~/components/portal/sections/ReportView";
import { ProgressView } from "~/components/portal/sections/ProgressView";
import { RepairBuilderSection } from "~/components/portal/sections/RepairBuilderSection";
import { MessagesSection } from "~/components/portal/sections/MessagesSection";
import { AgreementSection } from "~/components/portal/sections/AgreementSection";
import { PaymentSection } from "~/components/portal/sections/PaymentSection";
import type {
  ProgressLoaderResult,
  InvoiceLoaderResult,
  AgreementLoaderResult,
} from "~/lib/section-loaders";
import type { ReportLoaderResult } from "~/components/portal/sections/ReportView";
import type { LoaderResult as RepairLoaderResult } from "~/components/portal/sections/RepairBuilderSection";

interface HubSectionSlotProps {
  section: HubSection;
  tenant: string;
  inspectionId: string;
  token: string;
  signerToken: string | null;
  tokenSuffix: string;
  justPaid: boolean;
  documents: DocumentItem[] | null;
  report: ReportLoaderResult | null;
  progress: ProgressLoaderResult | null;
  repair: RepairLoaderResult | null;
  invoice: InvoiceLoaderResult | null;
  agreement: AgreementLoaderResult | null;
  docUploading: boolean;
  docError: string | null;
  onUpload: (
    file: File,
    opts: { category: DocumentCategory; visibility: DocumentVisibility; label?: string },
  ) => void;
  onDelete: (docId: string) => void;
}

export function HubSectionSlot({
  section,
  tenant,
  inspectionId,
  token,
  signerToken,
  tokenSuffix,
  justPaid,
  documents,
  report,
  progress,
  repair,
  invoice,
  agreement,
  docUploading,
  docError,
  onUpload,
  onDelete,
}: HubSectionSlotProps): React.ReactNode {
  // Build the active section's body (decision B/C). Overview renders the status
  // cards inside the Hub itself; this slot is only used on non-overview tabs.
  let sectionSlot: React.ReactNode = null;
  if (section === "documents") {
    sectionSlot = (
      <DocumentsSection
        items={documents ?? []}
        canUpload
        showVisibilityToggle={false}
        downloadHref={(docId) =>
          `/api/public/inspections/${inspectionId}/documents/${docId}${tokenSuffix}`
        }
        onUpload={onUpload}
        onDelete={onDelete}
        uploading={docUploading}
        error={docError}
      />
    );
  } else if (section === "report" && report) {
    sectionSlot = (
      <ReportView
        {...reportViewProps({
          ...report,
          tenant,
          inspectionId,
          token: token || undefined,
        })}
      />
    );
  } else if (section === "progress" && progress) {
    sectionSlot = (
      <ProgressView
        address={progress.address}
        date={progress.date}
        inspectorName={progress.inspectorName}
        status={progress.status}
        sections={progress.sections}
        error={progress.error}
      />
    );
  } else if (section === "repair" && repair) {
    sectionSlot = (
      <RepairBuilderSection
        result={repair}
        actionPath={`/repair-builder/${tenant}/${inspectionId}`}
      />
    );
  } else if (section === "payment" && invoice) {
    sectionSlot = (
      <PaymentSection
        invoice={invoice.invoice}
        brand={invoice.brand}
        inspectionId={inspectionId}
        error={invoice.error}
        justPaid={justPaid}
      />
    );
  } else if (section === "agreement") {
    sectionSlot = (
      <AgreementSection
        agreement={agreement?.agreement ?? null}
        error={agreement?.error ?? null}
        tenant={tenant}
        token={signerToken ?? ""}
        actionPath={`/agreements/sign/${tenant}/${signerToken ?? ""}`}
      />
    );
  } else if (section === "messages") {
    sectionSlot = (
      <MessagesSection inspectionId={inspectionId} token={token || undefined} />
    );
  }

  return sectionSlot;
}
