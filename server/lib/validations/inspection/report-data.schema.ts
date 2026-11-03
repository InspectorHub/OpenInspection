/**
 * The public report payload's schema — the document a RECIPIENT is served.
 *
 * Split out of `read.ts` when that file reached the large-file limit, on a seam
 * the file already had. Everything else there describes what an INSPECTION read
 * returns to staff; this describes what is handed to a client on a tokenised
 * link. Two audiences, two reasons to change, and only one of them is public.
 *
 * `read.ts` re-exports `ReportDataResponseSchema`, so no import site changed.
 */
import { z } from '@hono/zod-openapi';
import { inspectionRowFieldsWithout } from './inspection-row';
import { InspectionSchema } from './crud';

/** The item types a template item can have (the template schema's item types; tests/unit/reports/report-item-types-match-template.spec.ts fails when the two differ). */
export const REPORT_ITEM_TYPES = ['rich', 'boolean', 'text', 'textarea', 'number', 'select', 'multi_select', 'date', 'photo_only'] as const;

const ReportMediaSchema = z.object({
  kind: z.enum(['image', 'video-player', 'video-poster', 'r2-video-player', 'r2-video-poster']).describe('Which presentation applies.'),
  src: z.string().optional().describe('Image source (image).'),
  key: z.string().optional().describe('Storage key (image).'),
  streamUid: z.string().optional().describe('Stream video id (video-player, video-poster).'),
  mediaId: z.string().optional().describe('Stored video id (r2-video-player, r2-video-poster).'),
  posterUrl: z.string().optional().describe('Poster image URL (all video kinds).'),
  playerSrc: z.string().optional().describe('Player source URL (video-player, r2-video-player).'),
  playerLinkUrl: z.string().optional().describe('Link to the player page (video-poster).'),
  durationSec: z.number().optional().describe('Video duration in seconds.'),
  qr: z.boolean().optional().describe('True when the poster carries a QR code to the player (video-poster).'),
});

const ReportPhotoSchema = z.object({
  key: z.string().describe('Storage key of the photo as the report shows it (the annotated or cropped copy when there is one). The public report states it relative to the company (`inspections/<inspectionId>/...`); the staff payload carries the full key. The public photo route accepts both forms.'),
  url: z.string().describe('Download URL of the photo.'),
  originalKey: z.string().optional().describe('Storage key of the photo as it was first uploaded, before any crop or annotation. Stated like `key`: relative to the company in the public report, in full in the staff payload.'),
  media: ReportMediaSchema.optional().describe('How a video entry is presented (player, poster with a link, or a plain image). Present when the report is built with video context, as the public report is.'),
  photoNo: z.number().optional().describe('Continuous photo number in render order, used by the photo appendix. Present once the report numbers its photos.'),
});

const ReportItemSchema = z.object({
  id: z.string().describe('Item id.'),
  label: z.string().describe('Item label as shown in the report.'),
  rating: z.string().nullable().describe('Rating level id chosen for the item, or null when unrated.'),
  ratingColor: z.string().describe('Display colour of the chosen rating level.'),
  ratingLabel: z.string().nullable().describe('Display label of the chosen rating level, or null when unrated.'),
  severityBucket: z.enum(['satisfactory', 'monitor', 'defect', 'other']).describe('Report grouping the rating falls into.'),
  notes: z.string().nullable().describe('Inspector notes for the item, or null.'),
  photos: z.array(ReportPhotoSchema).describe('Photos attached to the item.'),
  recommendation: z.string().nullable().optional().describe('Recommendation text attached to the item, if any.'),
  // The next six are returned by the report-data service for every item (inspection-report.service.ts) and were missing from this document.
  // Optional here: a server that predates one leaves it out, and a client must cope with that. `tabs` and `resolvedTabs` (canned-comment trees)
  // are written down only on the staff payload, ReportDataFullSchema below: a free-form tree would turn into an unknown in the typed client of
  // the public report.
  type: z.string().optional().describe(`How the item is filled in: one of ${REPORT_ITEM_TYPES.join(', ')}. rich is a rating with canned-comment tabs, the others capture a value. A template item that names no type is rich. A client must treat a type it does not know as a plain captured value.`),
  parentId: z.string().nullable().optional().describe('Id of the item this one hangs under, or null for a top-level item.'),
  naKind: z.enum(['not_inspected', 'not_present']).nullable().optional().describe('Which kind of not-applicable rating the item carries, or null when it carries none.'),
  notInspectedReason: z.string().nullable().optional().describe('Why the item was not inspected, as the inspector wrote it, or null.'),
  unit: z.string().nullable().optional().describe('Unit of the captured value for a number item (from the template item options), or null.'),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).nullable().optional()
    // Null rides on the string branch, so a typed client reads `string | null` and not an untyped member of the union.
    .openapi({ anyOf: [{ type: 'string', nullable: true }, { type: 'number' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }] })
    .describe('The value captured for a non-rich item: text, a date or a choice as a string, a number, a yes or no, or the choices of a multi-select (a comma-separated string from the web editor, a list of strings from other clients). Null when nothing was captured or the stored value is of another shape.'),
  // No item-level estimateMin / estimateMax: the "Estimated cost" badge they
  // fed is gone. The `repairItems[]` pair below is a LEGACY READ — findings
  // written before repair pricing was withdrawn still hold the snapshot, and it
  // is emitted as null on every finding written since.
  ratingOptions: z.array(z.string()).nullable().optional().describe('The rating labels offered at the top of the item card, or null when the template sets none.'),
  original: z.object({
    rating: z.string().nullable().describe('Rating the item carried in the inspection this one follows up on, or null.'),
    notes: z.string().nullable().describe('Notes the item carried in that earlier inspection, or null.'),
    photos: z.array(ReportPhotoSchema).describe('Photos of the item from that earlier inspection.'),
  }).nullable().optional().describe('The baseline finding of a re-inspection, or null on a normal report.'),
  followupStatus: z.string().nullable().optional().describe('Follow-up status recorded for the item in a re-inspection, or null.'),
  followupNotes: z.string().nullable().optional().describe('Follow-up notes recorded for the item in a re-inspection, or null.'),
  repairItems: z.array(z.object({
    summary: z.string(),
    estimateMin: z.number().nullable(),
    estimateMax: z.number().nullable(),
    contractorType: z.string().nullable(),
  })).optional().describe('Attached repair items snapshotted on this finding (dollars, not cents).'),
}).openapi('ReportItem');

const ReportSectionSchema = z.object({
  id: z.string().describe('Section id.'),
  title: z.string().describe('Section title.'),
  icon: z.string().nullable().optional().describe('Icon name for the section, or null.'),
  defectCount: z.number().describe('Number of items in the section rated as defects.'),
  disclaimerText: z.string().nullable().optional().describe('Disclaimer printed under the section heading, or null when the template sets none.'),
  alwaysPageBreak: z.boolean().optional().describe('True when the section always starts on a new page.'),
  items: z.array(ReportItemSchema).describe('Items in the section.'),
}).openapi('ReportSection');

export const ReportDataResponseSchema = z.object({
  inspection: z.object({
    id: z.string().describe('Inspection id.'),
    propertyAddress: z.string().describe('Street address of the inspected property.'),
    date: z.string().describe('Inspection date.'),
    status: z.string().describe('Lifecycle status of the inspection.'),
    inspectorName: z.string().nullable().describe('Name of the inspector, or null.'),
  }).describe('Header facts about the inspection.'),
  styleProfile: z.object({
    id: z.string(),
    name: z.string(),
    schemaVersion: z.number(),
    colour: z.string().nullable(),
    badgeLayout: z.enum(['strip', 'inline']),
    photoColumns: z.number(),
    tokens: z.record(z.string(), z.string()),
  }).describe('Resolved report appearance profile (Report Style Presets)'),
  inspectorCredentials: z.array(z.object({
    label: z.string(),
    memberNumber: z.string().nullable(),
    imageUrl: z.string().nullable(),
  })).describe('Inspector self-asserted credentials snapshotted into the report (Spec B)'),
  stats: z.object({
    total: z.number().describe('Total number of rated items.'),
    satisfactory: z.number().describe('Number of items rated satisfactory.'),
    monitor: z.number().describe('Number of items rated for monitoring.'),
    defect: z.number().describe('Number of items rated as defects.'),
  }).describe('Rating counts across the whole report.'),
  sections: z.array(ReportSectionSchema).describe('Report sections in display order.'),
  ratingLevels: z.array(z.object({
    id: z.string().describe('Rating level id.'),
    label: z.string().describe('Rating level label.'),
    abbreviation: z.string().describe('Short form of the rating label.'),
    color: z.string().describe('Display colour of the rating level.'),
    severity: z.string().describe('Severity class of the rating level.'),
    isDefect: z.boolean().describe('True when items with this rating count as defects.'),
  })).describe('Rating levels available to the report, in display order.'),
}).openapi('ReportData');


const OPAQUE = (what: string) => z.unknown().optional().describe(`${what} Its shape is not written down yet.`);

/**
 * The report payload as STAFF read it (`GET /api/inspections/{id}/report-data`).
 *
 * `ReportDataResponseSchema` above is also what the public report is typed with, and the public report answers with a narrower inspection
 * header and only the keys listed in server/lib/report-link-response.ts. So the staff payload is a separate schema that adds to it and
 * leaves the shared one alone. Every addition is optional, and the opaque trees (the PCA report, cost tables, units) are `unknown` until
 * somebody writes their shape down.
 *
 * The inspection row extras are the same object the create and single-read responses use (inspection-row.ts), less the two columns the
 * report service removes (`price`, `internalNotes`). `tenantId` is not part of the published contract and is tracked in the undeclared-keys
 * allow-list.
 */
const ReportStaffItemSchema = ReportItemSchema.extend({
  tabs: OPAQUE('The canned-comment tabs of the template item (information, limitations, defects), or null.'),
  resolvedTabs: OPAQUE('The canned comments per tab with the choices of this inspection applied: information, limitations and defects.'),
});

export const ReportDataFullSchema = ReportDataResponseSchema.extend({
  inspection: ReportDataResponseSchema.shape.inspection.extend({
    ...InspectionSchema.pick({ inspectorId: true, templateId: true, createdAt: true }).partial().shape,
    // The report service removes these two from the inspection it returns, so this payload never carries them.
    ...inspectionRowFieldsWithout('price', 'internalNotes'),
  }),
  sections: z.array(ReportSectionSchema.extend({ items: z.array(ReportStaffItemSchema).describe('Items in the section.') })).describe('Report sections in display order.'),
  amendmentTrail: OPAQUE('Versions of the report published so far and whether it was amended.'),
  reinspection: OPAQUE('The re-inspection summary, or null on a normal report.'),
  coverPhotoUrl: z.string().nullable().optional().describe('Download URL of the report cover image, or null when none is chosen.'),
  outline: z.array(z.unknown()).optional().describe('Table of contents of a commercial report; empty for residential reports.'),
  photoMode: z.enum(['appendix', 'inline']).optional().describe('Where photos are shown: inline with the findings or in a central appendix.'),
  photoAppendix: z.array(z.unknown()).optional().describe('The numbered photo appendix of a commercial report.'),
  showEstimates: z.boolean().optional().describe('Whether repair estimates are shown in the report.'),
  enableCustomerRepairExport: z.boolean().optional().describe('Whether the client may export the repair list.'),
  reportTimeZone: z.string().optional().describe('IANA time zone the report dates are shown in.'),
  propertyFacts: z.record(z.string(), z.unknown()).nullable().optional().describe('The Property Facts values (year built, size, foundation and the like), or null.'),
  reportTier: z.string().nullable().optional().describe('Report tier of a commercial inspection (light_commercial or full_pca), or null.'),
  costTables: OPAQUE('The cost tables of a commercial report, or null.'),
  propertyType: z.string().nullable().optional().describe('What kind of property was inspected: single_family, multi_unit or commercial, or null when it was never classified. Other values may exist on rows written before the lists were unified.'),
  commercialSubtype: z.string().nullable().optional().describe('Commercial property subtype, or null.'),
  buildingProfile: z.array(z.unknown()).optional().describe('Building profile rows of a commercial report.'),
  pcaReport: OPAQUE('The property condition report block of a commercial inspection, or null.'),
  unitInspectionMode: z.enum(['tagged', 'per_unit']).optional().describe('Whether findings are tagged with a location or recorded per unit.'),
  units: z.array(z.unknown()).optional().describe('The unit tree of a per-unit inspection; empty otherwise.'),
  unitConditionMatrix: z.array(z.unknown()).optional().describe('Units by systems condition matrix; empty outside per-unit mode.'),
  defectCountsByUnit: OPAQUE('Defect counts keyed by unit; empty outside per-unit mode.'),
  samplingDeclaration: OPAQUE('What was sampled and what was not, or null.'),
  isPublished: z.boolean().optional().describe('True when the report has been published.'),
  signature: OPAQUE('The inspector signature block of a published report, or null.'),
  verification: OPAQUE('The verification block of a published report, or null.'),
  astmConformance: OPAQUE('The ASTM conformance summary of a commercial report, or null.'),
  reportSignoffs: z.array(z.unknown()).optional().describe('Sign-offs recorded for the report.'),
  psq: OPAQUE('The pre-survey questionnaire status and answers, or null.'),
  documentReview: z.array(z.unknown()).optional().describe('Documents requested and reviewed for the report.'),
  relianceText: OPAQUE('The reliance wording printed in a commercial report, or null.'),
}).openapi('ReportDataFull');
