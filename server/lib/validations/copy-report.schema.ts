import { z } from '@hono/zod-openapi';
import { InspectionSchema } from './inspection.schema';

/** How much of a finding the new report starts with. Same vocabulary as the editor's "clone last" preference. */
export const COPY_REPORT_SCOPES = ['rating', 'rating_notes', 'all'] as const;
export type CopyReportScope = (typeof COPY_REPORT_SCOPES)[number];

export const CopyReportBodySchema = z.object({
    scope: z.enum(COPY_REPORT_SCOPES).optional()
        .describe('What to copy per finding: rating only; rating and notes; or everything the allow-list carries (rating, notes, value, attributes, canned-comment and defect tabs, custom comments, tags). Defaults to rating_notes for the same property and to rating for a different one. Free-text fields (notes, value, attributes, the comment, title and location of defects and custom comments, annotationsJson) are copied verbatim and can still name the previous client, a door or lockbox code or the old street; deadline is the old job\'s absolute date.'),
    property: z.enum(['same', 'different']).default('same')
        .describe('same: the address and property facts come along. different: they are cleared and propertyAddress is required.'),
    propertyAddress: z.string().trim().min(1).max(500).optional()
        .describe('The address of the new report. Required when property is different, ignored otherwise.'),
    photos: z.boolean().default(false)
        .describe('Copy the finding photos as new objects under the new report. Off by default, and refused when property is different. The source photos are never shared or moved. Only a limited number are copied per request; see summary.photos.complete.'),
}).superRefine((value, ctx) => {
    if (value.property === 'different' && !value.propertyAddress) {
        ctx.addIssue({ code: 'custom', path: ['propertyAddress'], message: 'propertyAddress is required when property is different' });
    }
    if (value.property === 'different' && value.photos) {
        ctx.addIssue({ code: 'custom', path: ['photos'], message: 'photos cannot be copied to a different property' });
    }
}).transform((value) => ({ ...value, scope: value.scope ?? (value.property === 'different' ? 'rating' as const : 'rating_notes' as const) }));

export const CopyReportSummarySchema = z.object({
    people: z.object({
        requested: z.boolean().describe('True for a copy at the same property, where the client and agent links come along.'),
        copied: z.boolean().describe('False when copying the people links failed; the copy then has none.'),
    }),
    roster: z.object({ copied: z.boolean().describe('False when copying the lead and helper assignments failed.') }),
    findings: z.object({
        copied: z.number().int().describe('Findings that found a matching place in the new report.'),
        dropped: z.number().int().describe('Findings with no matching place in the new template; not copied.'),
    }),
    photos: z.object({
        requested: z.boolean().describe('Whether photos were asked for. Videos are never copied, whatever this says.'),
        copied: z.number().int(),
        failed: z.number().int().describe('Photos whose copy failed; they are not linked and leave no object behind.'),
        skipped: z.number().int().describe('Entries that are not copyable photos: videos, uploads still pending, or keys that are not an image or baked variant directly under the source report\'s own {company}/inspections/{id}/photos/ folder.'),
        unsupported: z.number().int().describe('Entries that look like photos but are not directly under the source\'s photos folder (for example an older key layout); not copied.'),
        droppedVariants: z.number().int().describe('Cropped or annotated versions that were not copied; the photo itself may still have been.'),
        deferred: z.number().int().describe('Photos beyond the per-request storage-call budget; not copied and not linked. Nothing continues them later.'),
        complete: z.boolean().nullable().describe('null when photos were not asked for. Otherwise false when anything photo-like is missing from the copy (failed, deferred, unsupported or a dropped variant), true only when every copyable photo and variant came across. Videos are never copied and do not count.'),
    }),
});

export const CopyReportDataSchema = z.object({
    inspection: InspectionSchema,
    summary: CopyReportSummarySchema,
});
