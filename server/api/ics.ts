import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { inspections } from '../lib/db/schema/inspection';
import { tenantConfigs } from '../lib/db/schema';
import { logger } from '../lib/logger';
import type { AppEnv } from '../types/hono';

const icsRoutes = new Hono<{ Bindings: AppEnv }>();

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

    let upcoming: Array<typeof inspections.$inferSelect> = [];
    try {
        const allRows = await db
            .select()
            .from(inspections)
            .where(eq(inspections.tenantId, tenantId));
        upcoming = allRows.filter((r) => {
            const d = r.date ?? '';
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

    const vevents = upcoming.map((r) => [
        'BEGIN:VEVENT',
        `UID:${r.id}@openinspection`,
        `SUMMARY:${escICS(r.propertyAddress ?? 'Inspection')}`,
        `DTSTART:${fmtDT(r.date)}`,
        `DTEND:${fmtDTEnd(r.date)}`,
        `DESCRIPTION:Client: ${escICS(r.clientName ?? '')} | Fee: $${r.price ?? 0}`,
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
