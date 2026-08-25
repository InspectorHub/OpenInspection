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
  id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
  label: z.string().describe('TODO describe label field for the OpenInspection MCP integration'),
  rating: z.string().nullable().describe('TODO describe rating field for the OpenInspection MCP integration'),
  ratingColor: z.string().describe('TODO describe ratingColor field for the OpenInspection MCP integration'),
  ratingLabel: z.string().nullable().describe('TODO describe ratingLabel field for the OpenInspection MCP integration'),
  severityBucket: z.enum(['satisfactory', 'monitor', 'defect', 'other']).describe('TODO describe severityBucket field for the OpenInspection MCP integration'),
  notes: z.string().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
  photos: z.array(z.object({ key: z.string().describe('TODO describe key field for the OpenInspection MCP integration'), url: z.string().describe('TODO describe url field for the OpenInspection MCP integration') })).describe('TODO describe photos field for the OpenInspection MCP integration'),
  recommendation: z.string().nullable().optional().describe('TODO describe recommendation field for the OpenInspection MCP integration'),
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
  id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
  title: z.string().describe('TODO describe title field for the OpenInspection MCP integration'),
  icon: z.string().nullable().optional().describe('TODO describe icon field for the OpenInspection MCP integration'),
  defectCount: z.number().describe('TODO describe defectCount field for the OpenInspection MCP integration'),
  items: z.array(ReportItemSchema).describe('TODO describe items field for the OpenInspection MCP integration'),
}).openapi('ReportSection');

export const ReportDataResponseSchema = z.object({
  inspection: z.object({
    id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    propertyAddress: z.string().describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    date: z.string().describe('TODO describe date field for the OpenInspection MCP integration'),
    status: z.string().describe('TODO describe status field for the OpenInspection MCP integration'),
    inspectorName: z.string().nullable().describe('TODO describe inspectorName field for the OpenInspection MCP integration'),
  }).describe('TODO describe inspection field for the OpenInspection MCP integration'),
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
    total: z.number().describe('TODO describe total field for the OpenInspection MCP integration'),
    satisfactory: z.number().describe('TODO describe satisfactory field for the OpenInspection MCP integration'),
    monitor: z.number().describe('TODO describe monitor field for the OpenInspection MCP integration'),
    defect: z.number().describe('TODO describe defect field for the OpenInspection MCP integration'),
  }).describe('TODO describe stats field for the OpenInspection MCP integration'),
  sections: z.array(ReportSectionSchema).describe('TODO describe sections field for the OpenInspection MCP integration'),
  ratingLevels: z.array(z.object({
    id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    label: z.string().describe('TODO describe label field for the OpenInspection MCP integration'),
    abbreviation: z.string().describe('TODO describe abbreviation field for the OpenInspection MCP integration'),
    color: z.string().describe('TODO describe color field for the OpenInspection MCP integration'),
    severity: z.string().describe('TODO describe severity field for the OpenInspection MCP integration'),
    isDefect: z.boolean().describe('TODO describe isDefect field for the OpenInspection MCP integration'),
  })).describe('TODO describe ratingLevels field for the OpenInspection MCP integration'),
}).openapi('ReportData');
