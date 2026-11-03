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

/** The item types a template item can have (the template schema's item types; tests/unit/reports/report-item-types-match-template.spec.ts fails when the two differ). */
export const REPORT_ITEM_TYPES = ['rich', 'boolean', 'text', 'textarea', 'number', 'select', 'multi_select', 'date', 'photo_only'] as const;

const ReportItemSchema = z.object({
  id: z.string().describe('Item id.'),
  label: z.string().describe('Item label as shown in the report.'),
  rating: z.string().nullable().describe('Rating level id chosen for the item, or null when unrated.'),
  ratingColor: z.string().describe('Display colour of the chosen rating level.'),
  ratingLabel: z.string().nullable().describe('Display label of the chosen rating level, or null when unrated.'),
  severityBucket: z.enum(['satisfactory', 'monitor', 'defect', 'other']).describe('Report grouping the rating falls into.'),
  notes: z.string().nullable().describe('Inspector notes for the item, or null.'),
  photos: z.array(z.object({ key: z.string().describe('Storage key of the photo.'), url: z.string().describe('Download URL of the photo.') })).describe('Photos attached to the item.'),
  recommendation: z.string().nullable().optional().describe('Recommendation text attached to the item, if any.'),
  // The next six are returned by the report-data service for every item (inspection-report.service.ts) and were missing from this document.
  // Optional here: a server that predates one leaves it out, and a client must cope with that. NOT documented yet, though returned: ratingOptions,
  // tabs, resolvedTabs, original, followupStatus, followupNotes (shapes still to be written down).
  type: z.string().optional().describe(`How the item is filled in: one of ${REPORT_ITEM_TYPES.join(', ')}. rich is a rating with canned-comment tabs, the others capture a value. A template item that names no type is rich. A client must treat a type it does not know as a plain captured value.`),
  parentId: z.string().nullable().optional().describe('Id of the item this one hangs under, or null for a top-level item.'),
  naKind: z.enum(['not_inspected', 'not_present']).nullable().optional().describe('Which kind of not-applicable rating the item carries, or null when it carries none.'),
  notInspectedReason: z.string().nullable().optional().describe('Why the item was not inspected, as the inspector wrote it, or null.'),
  unit: z.string().nullable().optional().describe('Unit of the captured value for a number item (from the template item options), or null.'),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).nullable().optional().describe('The value captured for a non-rich item: text, a date or a choice as a string, a number, a yes or no, or the choices of a multi-select (a comma-separated string from the web editor, a list of strings from other clients). Null when nothing was captured or the stored value is of another shape.'),
  // No item-level estimateMin / estimateMax: the "Estimated cost" badge they
  // fed is gone. The `repairItems[]` pair below is a LEGACY READ — findings
  // written before repair pricing was withdrawn still hold the snapshot, and it
  // is emitted as null on every finding written since.
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
