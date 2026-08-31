/**
 * The platform admin surface for statutory forms.
 *
 * ── WHY IT LIVES HERE AND NOT UNDER /api/admin ──────────────────────────────
 * Every answer below spans workspaces: how many installed a package, how many
 * documents went out on a revision, and whether a catalogue entry is offered at
 * all. None of that is a workspace's business, and there is no role on a
 * workspace token that should carry it — an owner asking how many other
 * companies are on revision 7-6 is a cross-tenant read wearing an admin hat.
 *
 * So the guard is `requireServiceBinding`, the same MAC over the shared keyring
 * that every other portal→core route uses, and it is a MAC rather than a role
 * on purpose: claiming to be the platform costs the key.
 *
 * ── WHAT A SELF-HOSTED DEPLOYMENT DOES INSTEAD ──────────────────────────────
 * `/api/integration/*` is 404 unless `APP_MODE=saas` (see workers/app.ts), so
 * these routes do not exist in a standalone build. That is the right shape and
 * not a gap: a standalone deployment has one workspace, so "who else is on this
 * revision" has no plural to answer, and its operator holds the database and
 * the catalogue source directly. The one statutory admin action a self-hosted
 * operator genuinely needs — supplying the authority's PDF — is a workspace
 * route (`server/api/admin/admin-statutory-source.ts`) precisely because there
 * is no platform on the other end of it.
 *
 * ── NO AUDIT ROW, DELIBERATELY ──────────────────────────────────────────────
 * `audit_logs` is tenant-scoped and every row carries a tenant_id. A delisting
 * belongs to no tenant, so filing it against one would put a platform action in
 * some workspace's own history, where it would read as something that workspace
 * did. It is logged instead, with the actor the signed header carried.
 */
import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { z } from 'zod';
import type { HonoConfig } from '../types/hono';
import { logger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { PUBLISHED_FORM_VERSIONS } from '../lib/statutory/forms';
import { revisionImpact } from '../services/statutory/revision-impact';
import {
    setCatalogueDelisted,
    statutoryInstallsByRevision,
} from '../services/marketplace/platform-catalogue';
import { requireServiceBinding } from './service-binding-guard';

const api = new Hono<HonoConfig>();

/**
 * Both are query parameters rather than path segments because a revision label
 * is the authority's own and contains slashes (`Rev. 04/26`), which a
 * percent-encoded path segment does not reliably survive.
 */
const ImpactQuerySchema = z.object({
    formId: z.string().trim().min(1),
    revision: z.string().trim().min(1),
});

const DelistBodySchema = z.object({
    /** Absent means delist. Passing `false` puts the entry back. */
    delisted: z.boolean().optional(),
});

/**
 * GET /api/integration/statutory-forms/installs
 *
 * Who is on which revision of which statutory package, with the roster. This is
 * the data behind "N workspaces are still on 7-6" and the first half of sizing
 * a recall; the second half is the impact route below.
 */
api.get('/statutory-forms/installs', requireServiceBinding, async (c) => {
    const data = await statutoryInstallsByRevision(drizzle(c.env.DB));
    return c.json({ success: true, data });
});

/**
 * GET /api/integration/statutory-forms/impact?formId=&revision=
 *
 * How many official documents were produced from one revision, by how many
 * workspaces. Answerable only because every production writes a row; before
 * that table existed this question had no answer at all, which made a recall
 * impossible rather than merely awkward.
 */
api.get('/statutory-forms/impact', requireServiceBinding, async (c) => {
    const parsed = ImpactQuerySchema.safeParse({
        formId: c.req.query('formId'),
        revision: c.req.query('revision'),
    });
    if (!parsed.success) {
        return c.json({
            success: false,
            error: { message: 'formId and revision are both required.' },
        }, 400);
    }
    const data = await revisionImpact(
        drizzle(c.env.DB), parsed.data.formId, parsed.data.revision, PUBLISHED_FORM_VERSIONS,
    );
    return c.json({ success: true, data });
});

/**
 * POST /api/integration/marketplace/:libraryId/delist
 *
 * Take a catalogue entry out of browse, or (`{"delisted": false}`) put it back.
 * Nothing is deleted and no install is touched — see the schema comment on
 * `marketplace_libraries.delisted_at` for why deleting is not on the table.
 */
api.post('/marketplace/:libraryId/delist', requireServiceBinding, async (c) => {
    const libraryId = c.req.param('libraryId') ?? '';
    if (libraryId === '') {
        return c.json({ success: false, error: { message: 'libraryId is required.' } }, 400);
    }
    // A body is optional; an unparseable one is treated as absent rather than
    // as a 500, because the default (delist) is the safe direction.
    const body = await c.req.json().catch(() => ({}));
    const parsed = DelistBodySchema.safeParse(body);
    const delisted = parsed.success ? parsed.data.delisted ?? true : true;

    try {
        const data = await setCatalogueDelisted(drizzle(c.env.DB), libraryId, delisted);
        logger.info('[statutory-admin] catalogue entry visibility changed', {
            libraryId, delisted,
            platformActorId: c.get('platformActor')?.platformAdminId ?? null,
        });
        return c.json({ success: true, data });
    } catch (error: unknown) {
        if (error instanceof AppError) {
            return c.json({ success: false, error: { message: error.message } }, 404);
        }
        throw error;
    }
});

export default api;
