/**
 * The report a person reads from a report link, as the HTTP response carries it.
 *
 * `getReportData` builds the whole report for the staff editor, the PDF and the Word export, starting from whole database rows: the
 * inspection row, the signoff rows, the document-review rows. The response for a report link is built from lists of fields instead: a
 * column reaches a report reader only when it is added to a list below on purpose.
 *
 * Applied at the route, after the report is built and after it has been handed to the translation reader, which receives the report as
 * built so that its text spans line up with it. The PDF and Word builders call the service directly and are not affected.
 *
 * What the report page reads of the inspection is its id, address, date, status and the inspector's name; of a signoff, who signed as what,
 * the licence, the qualifications reference, when, and whether the roles were combined; of a document-review row, which document and how it
 * was handled. Row identifiers of the company and of the person who signed are not part of the report.
 */
import type { ReportData } from './translation/report-span-register';
import { projectFields } from './response-projection';

type Inspection = ReportData['inspection'];
type Signoff = ReportData['reportSignoffs'][number];
type DocumentReviewRow = ReportData['documentReview'][number];

/** The inspection fields a report reader receives. Every other column of the row stays out of the response. */
export const REPORT_LINK_INSPECTION_FIELDS = ['id', 'propertyAddress', 'date', 'status', 'inspectorName'] as const satisfies readonly (keyof Inspection)[];

/** The signoff fields a report reader receives (not the company, the inspection or the signer's account id). */
export const REPORT_LINK_SIGNOFF_FIELDS = ['id', 'role', 'name', 'license', 'qualificationsRef', 'signedAt', 'signatureRef', 'dualRole'] as const satisfies readonly (keyof Signoff)[];

/** The document-review fields a report reader receives (not the company or the inspection). */
export const REPORT_LINK_DOCUMENT_REVIEW_FIELDS = ['id', 'documentKey', 'label', 'requested', 'received', 'reviewed', 'na', 'notes', 'sortOrder'] as const satisfies readonly (keyof DocumentReviewRow)[];

/**
 * Every top-level key of the report, and what the response does with it. A key added to `getReportData` is a compile error here until it is
 * classified, so it cannot reach a report reader by being forgotten. 'whole' keys are passed on as they are (they are report content);
 * 'projected' keys are rebuilt from the field lists above.
 */
const TOP_LEVEL: Record<keyof ReportData, 'whole' | 'projected'> = {
    amendmentTrail: 'whole',
    astmConformance: 'whole',
    buildingProfile: 'whole',
    commercialSubtype: 'whole',
    costTables: 'whole',
    coverPhotoUrl: 'whole',
    defectCountsByUnit: 'whole',
    documentReview: 'projected',
    enableCustomerRepairExport: 'whole',
    inspection: 'projected',
    inspectorCredentials: 'whole',
    isPublished: 'whole',
    outline: 'whole',
    pcaReport: 'whole',
    photoAppendix: 'whole',
    photoMode: 'whole',
    propertyFacts: 'whole',
    propertyType: 'whole',
    psq: 'whole',
    ratingLevels: 'whole',
    reinspection: 'whole',
    relianceText: 'whole',
    reportSignoffs: 'projected',
    reportTier: 'whole',
    reportTimeZone: 'whole',
    samplingDeclaration: 'whole',
    sections: 'whole',
    showEstimates: 'whole',
    signature: 'whole',
    stats: 'whole',
    styleProfile: 'whole',
    unitConditionMatrix: 'whole',
    unitInspectionMode: 'whole',
    units: 'whole',
    verification: 'whole',
};

/** The keys of the report the response may carry. Exported for the test that compares it with what the service returns. */
export const REPORT_LINK_TOP_LEVEL_KEYS: readonly string[] = Object.keys(TOP_LEVEL);

export type ReportLinkPayload = Omit<ReportData, 'inspection' | 'reportSignoffs' | 'documentReview'> & {
    inspection: Pick<Inspection, (typeof REPORT_LINK_INSPECTION_FIELDS)[number]>;
    reportSignoffs: Array<Pick<Signoff, (typeof REPORT_LINK_SIGNOFF_FIELDS)[number]>>;
    documentReview: Array<Pick<DocumentReviewRow, (typeof REPORT_LINK_DOCUMENT_REVIEW_FIELDS)[number]>>;
};

/**
 * Defensive about absent keys: the service always builds the whole payload (a pinned version only overlays the inspector, the credentials and
 * the style profile), so every key is present today. A payload that lacks one, such as a test double or a later change, is projected without
 * throwing and the key stays absent: a link never fails over a key it does not carry, and a key is never invented.
 */
export function projectReportForLink(data: ReportData): ReportLinkPayload {
    const { inspection, reportSignoffs, documentReview, ...rest } = data;
    const out: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([key]) => TOP_LEVEL[key as keyof ReportData] === 'whole'));
    if (inspection !== undefined && inspection !== null) out.inspection = projectFields(inspection, REPORT_LINK_INSPECTION_FIELDS);
    if (Array.isArray(reportSignoffs)) out.reportSignoffs = reportSignoffs.map((row) => projectFields(row, REPORT_LINK_SIGNOFF_FIELDS));
    if (Array.isArray(documentReview)) out.documentReview = documentReview.map((row) => projectFields(row, REPORT_LINK_DOCUMENT_REVIEW_FIELDS));
    return out as ReportLinkPayload;
}
