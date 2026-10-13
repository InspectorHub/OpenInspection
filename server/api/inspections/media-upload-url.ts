// Signed photo upload URLs for native clients (POST /{id}/media/upload-url).
// The URL points at the token-only route in ../public/uploads.ts, so a
// background upload does not depend on an access token that may have expired.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { Errors } from '../../lib/errors';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { PhotoUploadUrlRequestSchema, PhotoUploadUrlResponseSchema } from '../../lib/validations/media.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { signUploadToken } from '../../lib/video-upload-token';
import { SIGNED_PHOTO_EXT } from '../../lib/media/store-photo';
import { r2Keys } from '../../lib/r2-keys';

/** How long a signed photo upload URL stays valid: long enough for a device that queued the upload offline. */
const PHOTO_UPLOAD_TTL_SEC = 86400;

const photoUploadUrlRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/upload-url',
    tags: ['inspections'],
    summary: 'Mint a signed photo upload URL',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection the photo belongs to') }).describe('Path params'),
        body: { content: { 'application/json': { schema: PhotoUploadUrlRequestSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(PhotoUploadUrlResponseSchema) } },
            description: 'Signed upload URL',
        },
        401: { description: 'The caller is not a signed-in native client' },
        404: { description: 'Inspection not found in this workspace' },
    },
    operationId: 'createInspectionPhotoUploadUrl',
    description: 'Mint a signed, 24-hour photo upload URL for a native client. The URL needs no Authorization header, so a background upload survives an expired access token. The same pendingId always maps to the same storage key.',
}, { scopes: ['write'], tier: 'excluded' }));

const mediaUploadUrlRoutes = createApiRouter()
    .openapi(photoUploadUrlRoute, async (c) => {
        // Only a native client holds an upload that outlives its access token; a
        // web session has no use for a signed URL, so it is not offered one.
        if (!c.get('nativeClient')) throw Errors.Unauthorized('Native session required');
        const { id } = c.req.valid('param');
        const { pendingId, contentType } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const userId = c.get('user').sub;
        // Ownership check (404 on another tenant's inspection). Tenant is from the credential.
        await c.var.services.inspection.getInspection(id, tenantId);

        const ext = SIGNED_PHOTO_EXT[contentType];
        const token = await signUploadToken(
            { tenantId, inspectionId: id, mediaId: pendingId, ext, userId },
            PHOTO_UPLOAD_TTL_SEC,
            c.env.JWT_SECRET,
            'photo',
        );
        return c.json({
            success: true as const,
            data: {
                url: `/api/public/uploads/photo?token=${encodeURIComponent(token)}`,
                key: r2Keys.inspectionPhoto(tenantId, id, pendingId, ext),
                expiresAt: Date.now() + PHOTO_UPLOAD_TTL_SEC * 1000,
            },
        }, 200);
    });

export default mediaUploadUrlRoutes;
