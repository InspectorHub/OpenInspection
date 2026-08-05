import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { CredentialService } from '../services/credential.service';
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
import { DATE_FORMATS, TIME_FORMATS } from '../lib/session/display-prefs';
import { getDrizzle } from '../lib/route-helpers';
import { r2Put } from '../lib/r2/objects';

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
                        slug: z.string().nullable(),
                        photoUrl: z.string().nullable(),
                        signatureEnabled: z.boolean(),
                        savedSignature: z.string().nullable().describe('The inspector drawn signature as a data URI, or null when none is saved.'),
                        signaturePreviewHtml: z.string(),
                        timezone: z.string().nullable(),
                        locale: z.string().nullable(),
                        // #270 — null means "inherit the company setting", the
                        // same convention as timezone/locale above.
                        dateFormat: z.string().nullable(),
                        timeFormat: z.string().nullable(),
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
    signatureEnabled: z.boolean().optional().describe('Whether the inspector business-card footer is added to outbound emails'),
    timezone: z.string().refine((v) => v === '' || isValidTimeZone(v), 'Invalid timezone').optional().describe('Per-user display timezone (IANA). Empty string clears the override (inherit tenant).'),
    locale: z.string().refine((v) => v === '' || isValidLocale(v), 'Invalid locale').optional().describe('Per-user display locale (BCP-47). Empty string clears the override (inherit tenant).'),
    // #270 — SHAPE, not language. `.optional()` with NO `.default()` on purpose:
    // a default here would make an omitted key indistinguishable from an
    // explicit one and silently rewrite a preference the caller never mentioned.
    // Guarded by tests/unit/session/format-prefs-write-path.spec.ts, which
    // asserts the KEY IS ABSENT rather than asserting its value.
    dateFormat: z.enum(['', ...DATE_FORMATS]).optional().describe('Per-user date order (us|iso|eu). Empty string clears the override (inherit tenant).'),
    timeFormat: z.enum(['', ...TIME_FORMATS]).optional().describe('Per-user clock (12h|24h). Empty string clears the override (inherit tenant).'),
});

const patchProfileRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/',
    operationId: 'patchMyProfile',
    tags: ['profile'],
    summary: 'Update current user profile',
    description: 'Partially updates the authenticated user\'s profile (name, phone). DB-12: slug is frozen for inspectors — the field is silently stripped if sent. Agent slugs use POST /api/agent/profile.',
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
            slug: users.slug,
            photoUrl: users.photoUrl,
            signatureEnabled: users.signatureEnabled,
            timezone: users.timezone,
            locale: users.locale,
            dateFormat: users.dateFormat,
            timeFormat: users.timeFormat,
            // The drawn signature itself. Settings said "Signature saved" and
            // showed the reader nothing — so the one thing they might want to
            // check, that the right mark was captured, was the one thing the
            // page would not tell them.
            savedSignature: users.defaultSignatureBase64,
        }).from(users)
          .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
          .get();

        if (!row) throw Errors.NotFound('User not found');

        const host = new URL(c.req.url).host;
        const tenantSlug = c.get('requestedTenantSlug') ?? null;
        // The preview MUST carry credentials, or it shows a signature the
        // reader will never receive. `inspectorSignature` has accepted them
        // since Spec B; no caller ever supplied them, so the feature was wired
        // and dead — the badges render nowhere despite the settings copy
        // promising "shown on your reports, emails, and booking page".
        const credentials = await new CredentialService(c.env.DB).listRenderable(tenantId, userId);

        const signaturePreviewHtml = (row.name ?? '').trim()
          ? inspectorSignature({
              name: row.name, email: row.email, phone: row.phone,
              tenantSlug, credentials,
              // RELATIVE badge URLs. `host` here is the in-process API
              // request's, which in local dev is a different port than the
              // browser is on, so absolutizing against it pointed every badge
              // at a port with nothing behind it. The preview is drawn on this
              // app's own origin; letting the browser resolve them is both
              // simpler and immune to that whole class of mismatch.
            }, host, { assetOrigin: '' }).html
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
        if (body.signatureEnabled !== undefined) updates.signatureEnabled = body.signatureEnabled;
        // Per-user timezone override: empty string clears it (NULL = inherit tenant).
        if (body.timezone !== undefined) updates.timezone = body.timezone === '' ? null : body.timezone;
        // Per-user locale override: empty string clears it (NULL = inherit tenant).
        if (body.locale !== undefined) updates.locale = body.locale === '' ? null : body.locale;
        // #270 — per-user date/time SHAPE override, same '' = clear convention.
        if (body.dateFormat !== undefined) updates.dateFormat = body.dateFormat === '' ? null : body.dateFormat;
        if (body.timeFormat !== undefined) updates.timeFormat = body.timeFormat === '' ? null : body.timeFormat;
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
        await r2Put(c.env.PHOTOS, key, buf, { httpMetadata: { contentType: file.type } });

        // A RELATIVE path, stored. Every consumer of `users.photo_url` is a
        // browser surface — this page, the public booking page, concierge,
        // presence — so each already has the right origin and nothing needs one
        // baked in. The absolute form was built from the request's host, which
        // for an in-process API call is not the host the browser is on: the
        // photo saved fine and then rendered as a broken image, pointing at a
        // port nobody was serving. An absolute URL is also a hostage to the
        // deploy origin never changing, for no benefit here.
        const photoUrl = `/photos/${key}`;
        await getDrizzle(c).update(users)
            .set({ photoUrl })
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

        logger.info('profile.photo.upload', { userId, tenantId, size: file.size, type: file.type });
        return c.json({ success: true as const, data: { photoUrl } }, 200);
    });

export type ProfileApi = typeof profileRoutes;

export default profileRoutes;
