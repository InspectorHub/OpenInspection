import type { ComponentProps } from "react";
import { PropertyInfoForm } from "~/components/editor/PropertyInfoForm";
import { StatutoryDetailsHost } from "~/components/statutory/StatutoryDetailsHost";
import { PcaNarrativePanel } from "~/components/inspection/PcaNarrativePanel";
import { CompliancePanel } from "~/components/inspection-edit/CompliancePanel";
import { CommercialReportControls, type ReportTier } from "~/components/editor/CommercialReportControls";

/**
 * The "Inspection Details" overview — property facts, the statutory form
 * details panel, and the commercial-only controls beneath them.
 *
 * -- WHY IT IS A COMPONENT AND NOT JSX INSIDE THE ROUTE ----------------------
 * The route renders TWO separate trees, mobile and desktop, not one tree with a
 * breakpoint. This markup lived inline in the desktop tree only, so choosing
 * "Inspection Details" in the mobile Sections drawer set `activeView` to
 * "property" and the mobile `<main>` — which knows only about the item editor —
 * rendered NOTHING: no PROPERTY INFO heading and no statutory panel, at any
 * width. Measured at 390.
 *
 * The same shape of bug is recorded twice already in the route, on the photo
 * inputs and the add-media overlays, with the same fix: define it once and
 * mount it from both shells. Naming it also stops the two from drifting, which
 * hoisting it into a local would not have — a local is still 60 lines of markup
 * living in a 2,600-line file that is at its size cap.
 *
 * Every prop is derived by the route, and this component adds no state or
 * fetcher of its own, so it renders identically from either shell. Several of
 * its children DO own fetchers — they always did, each for a reason written
 * down where it lives — and this changes none of that: only ONE shell is
 * rendered at a time, so no child gained a second instance.
 */
interface InspectionOverviewProps {
    inspection: ComponentProps<typeof PropertyInfoForm>["inspection"];
    templateFields: ComponentProps<typeof PropertyInfoForm>["templateFields"];
    onSaveField: ComponentProps<typeof PropertyInfoForm>["onSave"];
    onCommitFacts: ComponentProps<typeof PropertyInfoForm>["onCommit"];
    statutoryDetails: ComponentProps<typeof StatutoryDetailsHost>["details"];
    pcaNarrative: ComponentProps<typeof PcaNarrativePanel>["narrative"];
    complianceData: ComponentProps<typeof CompliancePanel>["data"];
    savingCommercial: boolean;
    onChangeSubtype: (subtype: string | null) => void;
    onChangeTier: (tier: ReportTier) => void;
}

export function InspectionOverview({
    inspection,
    templateFields,
    onSaveField,
    onCommitFacts,
    statutoryDetails,
    pcaNarrative,
    complianceData,
    savingCommercial,
    onChangeSubtype,
    onChangeTier,
}: InspectionOverviewProps) {
    // Read once, so the three gates below cannot disagree about the same house.
    const bag = inspection as Record<string, unknown>;
    const isCommercial = bag.propertyType === "commercial";
    const reportTier = (bag.reportTier as ReportTier | null | undefined) ?? null;
    return (
        <>
            <PropertyInfoForm
                inspection={inspection}
                templateFields={templateFields}
                onSave={onSaveField}
                onCommit={onCommitFacts}
            />
            <StatutoryDetailsHost details={statutoryDetails} />
            {/* Commercial PCA Phase T — subtype + report tier selectors. Gated on
                the same propertyType === 'commercial' flag section-applicability.ts
                uses to decide PCA-only sections apply. Sits above the narrative
                panel so the subtype (which the Building Profile / cost tables key
                off) is set before the inspector writes narrative for a tier. */}
            {isCommercial ? (
                <div className="mt-8 border-t border-ih-border pt-6">
                    <CommercialReportControls
                        commercialSubtype={(bag.commercialSubtype as string | null | undefined) ?? null}
                        reportTier={reportTier}
                        saving={savingCommercial}
                        onChangeSubtype={onChangeSubtype}
                        onChangeTier={onChangeTier}
                    />
                </div>
            ) : null}
            {/* Commercial PCA Phase S — narrative editor panel, on the same gate. */}
            {isCommercial ? (
                <div className="mt-8 border-t border-ih-border pt-6">
                    <PcaNarrativePanel narrative={pcaNarrative} />
                </div>
            ) : null}
            {/* Commercial PCA Phase M Task 10 — compliance panel (dual sign-off /
                PSQ / doc-review checklist / conformance preview). Rendered ONLY at
                reportTier === 'full_pca' — a light_commercial report has no
                compliance surface (the Task 6 API 409s writes at any other tier).
                Self-manages its own fetchers/intents; the loader only supplies the
                read-side artifacts. */}
            {isCommercial && reportTier === "full_pca" ? (
                <div className="mt-8 border-t border-ih-border pt-6">
                    <CompliancePanel inspectionId={String(bag.id)} data={complianceData} />
                </div>
            ) : null}
        </>
    );
}
