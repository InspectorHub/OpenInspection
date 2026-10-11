import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types alongside it (same as the
// other scripts/lib modules the tooling specs import).
import { planReplyToBackfill } from '../../../scripts/lib/reply-to-backfill.mjs';

interface Plan {
    fills: { tenantId: string; email: string }[];
    skipped: { tenantId: string; reason: string }[];
}
const plan = (tenants: unknown[], owners: unknown[]) => planReplyToBackfill(tenants, owners) as Plan;

const t = (tenantId: string, replyTo: string | null) => ({ tenantId, replyTo });
const o = (tenantId: string, email: string, createdAt: number) => ({ tenantId, email, createdAt });

describe('planReplyToBackfill', () => {
    it('fills a NULL reply_to with the owner email', () => {
        expect(plan([t('a', null)], [o('a', 'own@a.test', 1)]).fills).toEqual([{ tenantId: 'a', email: 'own@a.test' }]);
    });

    it('treats empty and whitespace-only values as unset', () => {
        const r = plan([t('a', ''), t('b', '  \t ')], [o('a', 'x@a.test', 1), o('b', 'y@b.test', 1)]);
        expect(r.fills.map((f) => f.tenantId)).toEqual(['a', 'b']);
    });

    it('never overwrites a value that is already set', () => {
        const r = plan([t('a', 'keep@a.test')], [o('a', 'own@a.test', 1)]);
        expect(r.fills).toEqual([]);
        expect(r.skipped).toEqual([{ tenantId: 'a', reason: 'already-set' }]);
    });

    it('picks the earliest-created owner when a tenant has several', () => {
        const r = plan([t('a', null)], [o('a', 'late@a.test', 20), o('a', 'early@a.test', 5), o('a', 'mid@a.test', 9)]);
        expect(r.fills).toEqual([{ tenantId: 'a', email: 'early@a.test' }]);
    });

    it('skips a tenant with no owner', () => {
        const r = plan([t('a', null)], [o('b', 'own@b.test', 1)]);
        expect(r.fills).toEqual([]);
        expect(r.skipped).toEqual([{ tenantId: 'a', reason: 'no-owner' }]);
    });

    it('skips when the earliest owner has a blank email instead of falling through to a later owner', () => {
        const r = plan([t('a', null)], [o('a', '  ', 1), o('a', 'later@a.test', 2)]);
        expect(r.fills).toEqual([]);
        expect(r.skipped).toEqual([{ tenantId: 'a', reason: 'owner-email-blank' }]);
    });

    it('trims the owner email it writes', () => {
        expect(plan([t('a', null)], [o('a', ' own@a.test ', 1)]).fills[0]?.email).toBe('own@a.test');
    });
});
