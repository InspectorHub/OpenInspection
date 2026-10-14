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
