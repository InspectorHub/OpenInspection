import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspections } from '../lib/db/schema/inspection';
import { tenantConfigs, contactRoleProfiles, inspectionPeople } from '../lib/db/schema';
import { contacts } from '../lib/db/schema/contact';
import { PRIMARY_CLIENT_KEY } from '../lib/people/default-role-profiles';
import { logger } from '../lib/logger';
import { IcsService } from '../services/ics.service';
import { resolveInspectorIcsToken } from '../lib/calendar/inspector-ics-token';
import type { AppEnv } from '../types/hono';

const icsRoutes = new Hono<{ Bindings: AppEnv }>();

/**
 * GET /api/ics/inspector/:token
 *
 * One inspector's own schedule WITH property addresses, for their phone.
 *
 * Deliberately not hung off `/inspector/<tenant>/<slug>/` like the busy feed:
 * that surface is unauthenticated and `users.slug` is a name, so a guessable
 * URL would publish an inspector's daily route. The token is sealed under the
 * tenant AAD and resolves to (tenantId, userId) on its own — an unopenable or
 * tampered token is indistinguishable from a missing one (404 either way).
 *
 * Registered BEFORE `/:token`; that route matches a single segment, so the two
 * cannot collide, but order keeps the intent obvious.
 */
icsRoutes.get('/inspector/:token', async (c) => {
    const { token } = c.req.param();
    if (!token || !c.env.JWT_SECRET) return c.text('Not found', 404);

    const resolved = await resolveInspectorIcsToken(
        token, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
    );
    if (!resolved) return c.text('Not found', 404);

    const host = c.req.header('host') ?? 'openinspection';
    const ics = await new IcsService(c.env.DB, host)
        .scheduleFeedForInspector(resolved.tenantId, resolved.userId);

    return new Response(ics, {
        status: 200,
        headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            // Private: this body contains addresses. No shared-cache storage.
            'Cache-Control': 'private, max-age=300',
            'Content-Disposition': 'inline; filename="my-schedule.ics"',
        },
    });
});

/**
 * GET /api/ics/:token
 * Public, token-based ICS subscription feed.
 * Returns a VCALENDAR document with the tenant's upcoming 90 days of inspections.
 * Apple Calendar / Google Calendar / any RFC 5545-aware client can subscribe via plain HTTP polling.
 */
icsRoutes.get('/:token', async (c) => {
    const { token } = c.req.param();
    if (!token || token.length < 16) return c.text('Not found', 404);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = drizzle(c.env.DB as any);

    const configs = await db
        .select()
        .from(tenantConfigs)
        .where(eq(tenantConfigs.icsToken, token))
        .limit(1);

    if (!configs[0]) return c.text('Not found', 404);
    const tenantId = configs[0].tenantId;

    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Task 9c (people-role-profiles) — the client name embedded in each
    // VEVENT's DESCRIPTION is sourced from the inspection_people
    // primary-client join (contact_role_profiles filtered to 'client' BEFORE
    // joining inspection_people, mirroring the join order in api/metrics.ts),
    // not the legacy inspections.client_name column (frozen cache, dropped
    // Task 13). One LEFT JOIN keeps the up-to-90-day feed N+1-free.
    let upcoming: Array<{ inspection: typeof inspections.$inferSelect; primaryClientName: string | null }> = [];
    try {
        const allRows = await db
            .select({ inspection: inspections, primaryClientName: contacts.name })
            .from(inspections)
            .leftJoin(contactRoleProfiles, and(
                eq(contactRoleProfiles.tenantId, inspections.tenantId),
                eq(contactRoleProfiles.key, PRIMARY_CLIENT_KEY),
                eq(contactRoleProfiles.active, true),
            ))
            .leftJoin(inspectionPeople, and(
                eq(inspectionPeople.roleProfileId, contactRoleProfiles.id),
                eq(inspectionPeople.inspectionId, inspections.id),
                eq(inspectionPeople.tenantId, inspections.tenantId),
            ))
            .leftJoin(contacts, and(
                eq(contacts.id, inspectionPeople.contactId),
                eq(contacts.tenantId, inspections.tenantId),
            ))
            .where(eq(inspections.tenantId, tenantId));
        upcoming = allRows.filter((r) => {
            const d = r.inspection.date ?? '';
            return d >= today && d <= future;
        });
    } catch (e) {
        logger.error('[ics] Failed to load inspections', { tenantId }, e instanceof Error ? e : undefined);
    }

    // inspections.date may be either YYYY-MM-DD or a full ISO timestamp; normalize to date-only.
    function dateOnly(dateStr: string): string {
        if (!dateStr) return '';
        return dateStr.slice(0, 10).replace(/-/g, '');
    }
    function fmtDT(dateStr: string): string {
        const d = dateOnly(dateStr);
        return d ? `${d}T090000Z` : '';
    }
    function fmtDTEnd(dateStr: string): string {
        const d = dateOnly(dateStr);
        return d ? `${d}T120000Z` : '';
    }
    function escICS(s: string): string {
        return (s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    }

    // Prefer the request's Host header (production URL) over APP_BASE_URL which may be set to
    // localhost in development env vars and accidentally leaked into deploy. Fall back to APP_BASE_URL.
    const reqHost = c.req.header('host');
    const baseUrl = reqHost
        ? `https://${reqHost}`
        : (c.env.APP_BASE_URL ?? 'https://openinspection.app');

    const vevents = upcoming.map(({ inspection: r, primaryClientName }) => [
        'BEGIN:VEVENT',
        `UID:${r.id}@openinspection`,
        `SUMMARY:${escICS(r.propertyAddress ?? 'Inspection')}`,
        `DTSTART:${fmtDT(r.date)}`,
        `DTEND:${fmtDTEnd(r.date)}`,
        `DESCRIPTION:Client: ${escICS(primaryClientName ?? '')} | Fee: $${r.price ?? 0}`,
        `URL:${baseUrl}/inspections/${r.id}/edit`,
        'END:VEVENT',
    ].join('\r\n')).join('\r\n');

    const ics = [
        'BEGIN:VCALENDAR',
        'PRODID:-//OpenInspection//EN',
        'VERSION:2.0',
        'CALSCALE:GREGORIAN',
        'X-WR-CALNAME:OpenInspection Schedule',
        vevents,
        'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');

    c.header('Content-Type', 'text/calendar; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="openinspection.ics"');
    return c.text(ics);
});

export default icsRoutes;
