import { z } from '@hono/zod-openapi';
import { REPORT_LINK_TTL_MAX_COUNT } from '../report-link-ttl';

/**
 * IA-36 ⑤⑥ — the wire shape of a report-link expiry policy.
 *
 * Two endpoints take this (per-inspection on `inspections/people`, tenant-wide
 * on `inspection-prefs`) and they must accept exactly the same thing: an
 * operator who learns the control on one screen is entitled to be right about
 * the other. Kept here rather than beside whichever route happened to need it
 * first, per the schema-location rule.
 *
 * A DURATION, never an absolute date. Only an absolute date can be set in the
 * past, so "expires before it is sent" is impossible by construction. Wanting a
 * link dead NOW is a different verb (Reset / Remove), not an expiry of zero.
 */
export const ReportLinkTtlSchema = z.union([
    z.literal('never'),
    z.object({
        count: z.number().int().min(1).max(REPORT_LINK_TTL_MAX_COUNT).describe('How many units from now the links stop working.'),
        unit: z.enum(['days', 'months', 'years']).describe('Unit the count is expressed in: days, months or years.'),
    }),
]).describe('A DURATION from now, or "never". Deliberately not an absolute date — only an absolute date can be set in the past.');
