import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { Errors } from '../lib/errors';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { users } from '../lib/db/schema/tenant';
import { logger } from '../lib/logger';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { inspectorSignature } from '../lib/inspector-signature';
import { r2Keys } from '../lib/r2-keys';
import { isValidTimeZone } from '../lib/tz';
import { isValidLocale } from '../lib/locale';

/**
 * Booking #7 Sprint A — authenticated profile endpoint mounted at
 * `/api/profile/*`. JWT middleware populates tenantId/userId; availability
 * is re-checked inside the handler to close the optimistic-UI race.
 */

const getProfileRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/',
    operationId: 'getMyProfile',
    tags: ['profile'],
    summary: 'Get current user profile',
    description: 'Returns the authenticated user\'s editable profile fields (name, phone, license, slug, photo URL).',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        name: z.string().nullable(),
                        email: z.string(),
                        phone: z.string().nullable(),
                        licenseNumber: z.string().nullable(),
                        slug: z.string().nullable(),
                        photoUrl: z.string().nullable(),
                        signatureEnabled: z.boolean(),
                        signaturePreviewHtml: z.string(),
                        timezone: z.string().nullable(),
                        locale: z.string().nullable(),
                    })),
                },
            },
            description: 'Profile data',
        },
    },
}, { scopes: ['read'], tier: 'primary' }));

// DB-12 / IA-26 (2026-06-06) — slug FROZEN for inspectors. The field is
// intentionally absent from this schema so Zod strips it from any PATCH body;
// no 400 is raised (unknown keys are ignored via passthrough behavior). Global
// AGENT slugs use a completely separate endpoint (POST /api/agent/profile) and
// are unaffected.
export const PatchProfileSchema = z.object({
    name: z.string().max(100).optional().describe('Display name shown on reports and the booking page'),
    phone: z.string().max(30).optional().describe('Contact phone number for the inspector profile'),
    licenseNumber: z.string().max(50).optional().describe('Professional inspector license or certification number'),
    signatureEnabled: z.boolean().optional().describe('Whether the inspector business-card footer is added to outbound emails'),
    timezone: z.string().refine((v) => v === '' || isValidTimeZone(v), 'Invalid timezone').optional().describe('Per-user display timezone (IANA). Empty string clears the override (inherit tenant).'),
    locale: z.string().refine((v) => v === '' || isValidLocale(v), 'Invalid locale').optional().describe('Per-user display locale (BCP-47). Empty string clears the override (inherit tenant).'),
});

const patchProfileRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/',
    operationId: 'patchMyProfile',
    tags: ['profile'],
    summary: 'Update current user profile',
    description: 'Partially updates the authenticated user\'s profile (name, phone, licenseNumber). DB-12: slug is frozen for inspectors — the field is silently stripped if sent. Agent slugs use POST /api/agent/profile.',
    request: {
        body: {
            content: {
                'application/json': { schema: PatchProfileSchema },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ ok: z.literal(true) })),
                },
            },
            description: 'Saved',
        },
    },
}, { scopes: ['write'], tier: 'primary' }));

// ── Sprint C-1 — profile photo upload ─────────────────────────────────────────

const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_PHOTO_BYTES = 2_000_000;

const photoUploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/photo',
    operationId: 'uploadMyProfilePhoto',
    tags: ['profile'],
    summary: 'Upload inspector profile photo',
    description: 'Accepts a jpg/png/webp photo (max 2 MB) as multipart form data, stores it in R2 under a tenant-scoped key, and saves the public photoUrl on the user record.',
    request: {
        body: {
            content: {
                'multipart/form-data': { schema: z.object({ photo: z.any().describe('Profile photo file — jpg, png, or webp; max 2 MB.') }).describe('TODO describe schema field for the OpenInspection MCP integration') },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ photoUrl: z.string().describe('TODO describe photoUrl field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Uploaded',
        },
    },
}, { scopes: ['write'], tier: 'extended' }));

const profileRoutes = createApiRouter()
    .openapi(getProfileRoute, async (c) => {
        const userId = c.get('user')?.sub;
        const tenantId = c.get('tenantId');
        if (!userId || !tenantId) throw Errors.Unauthorized();

        const row = await drizzle(c.env.DB as never).select({
            name: users.name,
            email: users.email,
            phone: users.phone,
            licenseNumber: users.licenseNumber,
            slug: users.slug,
            photoUrl: users.photoUrl,
            signatureEnabled: users.signatureEnabled,
            timezone: users.timezone,
            locale: users.locale,
        }).from(users)
          .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
          .get();

        if (!row) throw Errors.NotFound('User not found');

        const host = new URL(c.req.url).host;
        const tenantSlug = c.get('requestedTenantSlug') ?? null;
        const signaturePreviewHtml = (row.name ?? '').trim()
          ? inspectorSignature({
              name: row.name, email: row.email, phone: row.phone,
              licenseNumber: row.licenseNumber, tenantSlug,
            }, host).html
          : '';

        return c.json({
            success: true as const,
            data: { ...row, signatureEnabled: row.signatureEnabled, signaturePreviewHtml },
        }, 200);
    })
    .openapi(patchProfileRoute, async (c) => {
        const userId = c.get('user')?.sub;
        const tenantId = c.get('tenantId');
        if (!userId || !tenantId) throw Errors.Unauthorized();

        const body = c.req.valid('json');
        const updates: Record<string, unknown> = {};

        if (body.name !== undefined) updates.name = body.name;
        if (body.phone !== undefined) updates.phone = body.phone;
        if (body.licenseNumber !== undefined) updates.licenseNumber = body.licenseNumber;
        if (body.signatureEnabled !== undefined) updates.signatureEnabled = body.signatureEnabled;
        // Per-user timezone override: empty string clears it (NULL = inherit tenant).
        if (body.timezone !== undefined) updates.timezone = body.timezone === '' ? null : body.timezone;
        // Per-user locale override: empty string clears it (NULL = inherit tenant).
        if (body.locale !== undefined) updates.locale = body.locale === '' ? null : body.locale;
        // DB-12 / IA-26 — slug write removed; inspector booking slugs are frozen.
        // Agent slug writes go through POST /api/agent/profile (separate endpoint).

        if (Object.keys(updates).length > 0) {
            await drizzle(c.env.DB as never).update(users)
                .set(updates)
                .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
        }

        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(photoUploadRoute, async (c) => {
        const userId = c.get('user')?.sub;
        const tenantId = c.get('tenantId');
        if (!userId || !tenantId) throw Errors.Unauthorized();

        if (!c.env.PHOTOS) throw Errors.BadRequest('Photo storage not available');

        const fd = await c.req.parseBody();
        const file = fd['photo'];
        if (!(file instanceof File)) throw Errors.BadRequest('photo missing');
        if (file.size > MAX_PHOTO_BYTES) {
            throw Errors.BadRequest(`photo > ${Math.round(MAX_PHOTO_BYTES / 1_000_000)}MB`);
        }
        if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(file.type)) {
            throw Errors.BadRequest('photo must be jpg, png, or webp');
        }

        const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
        // Tenant-prefixed key keeps cross-tenant photos isolated even though the
        // serving route at /photos/:key is public — keys are unguessable + scoped.
        const key = r2Keys.inspectorPhoto(tenantId, userId, ext);
        const buf = new Uint8Array(await file.arrayBuffer());
        await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: file.type } });

        const host = (c.env.APP_BASE_URL?.replace(/^https?:\/\//, '').replace(/\/$/, '')) || c.req.header('host') || '';
        const proto = c.env.APP_BASE_URL?.startsWith('http://') ? 'http' : 'https';
        const photoUrl = `${proto}://${host}/photos/${key}`;
        await drizzle(c.env.DB).update(users)
            .set({ photoUrl })
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

        logger.info('profile.photo.upload', { userId, tenantId, size: file.size, type: file.type });
        return c.json({ success: true as const, data: { photoUrl } }, 200);
    });

export type ProfileApi = typeof profileRoutes;

export default profileRoutes;
