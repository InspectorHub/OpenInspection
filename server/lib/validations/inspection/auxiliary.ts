import { z } from '@hono/zod-openapi';

/**
 * Round-2 backlog #9 (Spectora §E.3) — Media Center.
 *
 * Two-list payload: photos already attached to an item plus the loose pool
 * of bulk-uploaded shots awaiting placement. The drawer renders both groups
 * with the same card UI, but only attached photos carry an itemId/section.
 */
export const MediaCenterAttachedPhotoSchema = z.object({
    key:           z.string().describe('TODO describe key field for the OpenInspection MCP integration'),
    originalKey:   z.string().describe('Source R2 key (revert target); differs from key when the photo is annotated'),
    url:           z.string().describe('TODO describe url field for the OpenInspection MCP integration'),
    itemId:        z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
    itemLabel:     z.string().describe('TODO describe itemLabel field for the OpenInspection MCP integration'),
    sectionId:     z.string().describe('TODO describe sectionId field for the OpenInspection MCP integration'),
    sectionTitle:  z.string().describe('TODO describe sectionTitle field for the OpenInspection MCP integration'),
    photoIndex:    z.number().int().nonnegative().describe('TODO describe photoIndex field for the OpenInspection MCP integration'),
    annotated:     z.boolean().describe('TODO describe annotated field for the OpenInspection MCP integration'),
    defectId:      z.string().optional().describe('Defect id when the photo hangs off a canned/custom defect rather than the item'),
}).openapi('MediaCenterAttachedPhoto');

export const MediaCenterPoolPhotoSchema = z.object({
    id:            z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    key:           z.string().describe('TODO describe key field for the OpenInspection MCP integration'),
    url:           z.string().describe('TODO describe url field for the OpenInspection MCP integration'),
    uploadedAt:    z.number().int().describe('TODO describe uploadedAt field for the OpenInspection MCP integration'),
    takenAt:       z.number().int().nullable().describe('TODO describe takenAt field for the OpenInspection MCP integration'),
}).openapi('MediaCenterPoolPhoto');

export const MediaCenterResponseSchema = z.object({
    attached:  z.array(MediaCenterAttachedPhotoSchema).describe('TODO describe attached field for the OpenInspection MCP integration'),
    pool:      z.array(MediaCenterPoolPhotoSchema).describe('TODO describe pool field for the OpenInspection MCP integration'),
}).openapi('MediaCenterResponse');

export const MediaPoolUploadResponseSchema = z.object({
    id:          z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    key:         z.string().describe('TODO describe key field for the OpenInspection MCP integration'),
    url:         z.string().describe('TODO describe url field for the OpenInspection MCP integration'),
    uploadedAt:  z.number().int().describe('TODO describe uploadedAt field for the OpenInspection MCP integration'),
    takenAt:     z.number().int().nullable().describe('TODO describe takenAt field for the OpenInspection MCP integration'),
}).openapi('MediaPoolUploadResponse');

export const MediaAttachRequestSchema = z.object({
    poolId: z.string().min(1).describe('TODO describe poolId field for the OpenInspection MCP integration'),
    itemId: z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration'),
    sectionId: z.string().min(1).optional().describe('Section ID for composite finding key'),
}).openapi('MediaAttachRequest');

export const MediaAttachResponseSchema = z.object({
    key:        z.string().describe('TODO describe key field for the OpenInspection MCP integration'),
    itemId:     z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
    photoIndex: z.number().int().nonnegative().describe('TODO describe photoIndex field for the OpenInspection MCP integration'),
}).openapi('MediaAttachResponse');

// Media Studio (Plan 3) — reorder an item's photos[] by key. The reorder is
// pure permutation: the submitted key multiset must equal the current one
// (no add/drop). Array order == report photo order.
export const ReorderPhotosSchema = z.object({
    order: z.array(z.string().min(1)).min(1).describe('Full list of photo display keys in the desired order'),
    sectionId: z.string().min(1).optional().describe('Section ID for composite finding key'),
}).openapi('ReorderPhotosRequest');

// Media Studio (Plan 3) — body for detach/revert (only the optional sectionId
// needed to resolve the composite finding key; the photo is addressed by the
// :photoIndex path param).
export const ItemPhotoMutationSchema = z.object({
    sectionId: z.string().min(1).optional().describe('Section ID for composite finding key'),
}).openapi('ItemPhotoMutationRequest');

// Media Studio (Plan 3, Task 9b) — body for moving a photo from one item to
// another. The source photo is addressed by the :itemId + :photoIndex path
// params; the body carries the target item (and the optional composite-key
// section on either side).
export const MovePhotoSchema = z.object({
    toItemId: z.string().min(1).describe('Target item id the photo moves to'),
    toSectionId: z.string().optional().describe('Target section id for composite finding key'),
    fromSectionId: z.string().optional().describe('Source section id for composite finding key'),
}).openapi('MovePhotoRequest');

/**
 * Media Studio (cover crop) — re-editable crop transform applied to the
 * source cover image, in source-pixel coordinates.
 */
export const CoverCropSchema = z.object({
    aspect: z.enum(['3:2', '16:9', '1.91:1', '4:3']),
    orientation: z.enum(['landscape', 'portrait']),
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().positive(),
    height: z.number().positive(),
});
export type CoverCrop = z.infer<typeof CoverCropSchema>;

/**
 * Media Studio (Plan 4) — re-editable crop transform for an inspection-item or
 * per-defect photo. Unlike CoverCropSchema, the aspect may be 'free' (item/defect
 * photos are not constrained to cover ratios). Coords are source-pixel.
 */
export const PhotoCropSchema = z.object({
    aspect: z.enum(['free', '3:2', '16:9', '1.91:1', '4:3']),
    orientation: z.enum(['landscape', 'portrait']),
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().positive(),
    height: z.number().positive(),
});
export type PhotoCrop = z.infer<typeof PhotoCropSchema>;
