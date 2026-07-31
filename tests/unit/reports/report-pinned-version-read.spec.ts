/**
 * Reading a PINNED published version.
 *
 * Two separate claims, and they fail in different ways:
 *
 *   1. The version travels inside the SIGNED render token, never as a query
 *      param. A link holder who could append `&v=1` to a report URL would be
 *      asking the renderer for a version they were never sent.
 *   2. When a version is named, the fields the snapshot captured come from it.
 *      Before this, the "frozen" per-version PDF was rendered from the LIVE page
 *      the first time somebody downloaded it — so the freezing was a caching
 *      side effect, and a v3 PDF nobody had fetched would be generated from data
 *      as it stood whenever they got round to it.
 */
import { describe, it, expect } from 'vitest';
import { signRenderToken, verifyRenderToken } from '../../../server/lib/render-token';
import { buildRenderReportUrl } from '../../../server/lib/public-urls';
import { pinnedLead, type Snapshot } from '../../../server/lib/version-diff';
import { primaryLicenseOf } from '../../../server/services/credential.service';

const SECRET = 'test-secret';
const INSPECTION = 'insp-1';

describe('render token — the pinned version claim', () => {
    it('round-trips a version number', async () => {
        const t = await signRenderToken(INSPECTION, SECRET, undefined, 3);
        expect(await verifyRenderToken(t, SECRET)).toEqual({ inspectionId: INSPECTION, versionNumber: 3 });
    });

    it('omits the claim entirely when no version is named', async () => {
        const t = await signRenderToken(INSPECTION, SECRET);
        const v = await verifyRenderToken(t, SECRET);
        // Absent, not zero and not null: `typeof v === 'number'` is what decides
        // between the snapshot and live resolution downstream.
        expect(v).toEqual({ inspectionId: INSPECTION });
        expect('versionNumber' in v!).toBe(false);
    });

    it('cannot be forged or edited — the version is inside the HMAC body', async () => {
        const real = await signRenderToken(INSPECTION, SECRET, undefined, 1);
        const [body, sig] = real.split('.');

        // Re-encode the body with a different version, keeping the signature.
        const decoded = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')
            + '='.repeat((4 - (body.length % 4)) % 4))) as Record<string, unknown>;
        decoded.v = 99;
        const forgedBody = btoa(JSON.stringify(decoded))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        expect(await verifyRenderToken(`${forgedBody}.${sig}`, SECRET)).toBeNull();
    });

    it('a token signed with another secret names nothing', async () => {
        const t = await signRenderToken(INSPECTION, 'someone-elses-secret', undefined, 2);
        expect(await verifyRenderToken(t, SECRET)).toBeNull();
    });
});

describe('buildRenderReportUrl', () => {
    it('puts the version in the TOKEN, not the query string', async () => {
        const url = await buildRenderReportUrl('app.test', 'acme', INSPECTION, SECRET, 4);
        // The whole point: nothing in the visible URL says "4", so nothing in
        // the visible URL can be edited to say "5".
        expect(url).not.toContain('v=4');
        expect(url).not.toContain('version');
        const token = decodeURIComponent(new URL(url).searchParams.get('render')!);
        expect(await verifyRenderToken(token, SECRET)).toMatchObject({ versionNumber: 4 });
    });

    it('mints an unpinned token when no version is given', async () => {
        const url = await buildRenderReportUrl('app.test', 'acme', INSPECTION, SECRET);
        const token = decodeURIComponent(new URL(url).searchParams.get('render')!);
        const v = await verifyRenderToken(token, SECRET);
        expect('versionNumber' in v!).toBe(false);
    });
});

/**
 * Who a pinned read credits, and with what.
 *
 * NULL AND `[]` ARE DIFFERENT ANSWERS, and conflating them is the hazard on the
 * credentials: one means "this report predates the capture, live is all there
 * is", the other means "the inspector held none on publish day". As JSON they
 * look identical; on a cover page they are opposites, and the wrong one either
 * hides a badge a document carried or resurrects one it never did.
 */
describe('pinnedLead', () => {
    const cred = (label: string, memberNumber: string | null = null) => ({ label, memberNumber, imageUrl: null });
    const snap = (inspectors?: Snapshot['inspectors']): Snapshot =>
        ({ data: {}, units: [], ...(inspectors ? { inspectors } : {}) });

    it('returns null when nothing is pinned at all', () => {
        expect(pinnedLead(null)).toBeNull();
        expect(pinnedLead(undefined)).toBeNull();
    });

    it('returns null for a v1 snapshot, so live fills in', () => {
        // Those reports WERE rendered live when they were delivered. Serving an
        // empty strip instead would be inventing history, not recording it.
        expect(pinnedLead(snap())).toBeNull();
    });

    it('returns null for an empty inspector list', () => {
        expect(pinnedLead(snap([]))).toBeNull();
    });

    it('returns a lead who held NO credentials — that is a real answer, not a gap', () => {
        // The distinction that stops live state leaking back into a frozen
        // document: this must not be null, or the `?? live` fallback fires.
        const lead = pinnedLead(snap([
            { userId: 'u1', name: 'Dana', role: 'lead', credentials: [] },
        ]));
        expect(lead).not.toBeNull();
        expect(lead!.credentials).toEqual([]);
    });

    it('picks the LEAD, whatever order the inspectors are in', () => {
        const lead = pinnedLead(snap([
            { userId: 'u2', name: 'Sam', role: 'helper', credentials: [cred('Helper cert')] },
            { userId: 'u1', name: 'Dana', role: 'lead', credentials: [cred('Lead cert')] },
        ]));
        // Option A. Pooling both would put an unattributed claim on the cover
        // that neither person made.
        expect(lead!.userId).toBe('u1');
        expect(lead!.credentials.map((c) => c.label)).toEqual(['Lead cert']);
    });

    it('falls back to the first inspector when no one is marked lead', () => {
        const lead = pinnedLead(snap([
            { userId: 'u2', name: 'Sam', role: 'helper', credentials: [cred('Only cert')] },
        ]));
        expect(lead!.userId).toBe('u2');
    });

    /**
     * The defect this shape exists to prevent.
     *
     * Name, licence and badges are three facts about ONE person on ONE document.
     * Pinning the badge strip and leaving the other two to resolve live gave a
     * renewed inspector the old number in the strip and the new one on the
     * signature block — the same document asserting two licence numbers.
     */
    it('carries the name and the licence alongside the badges, from one source', () => {
        const lead = pinnedLead(snap([{
            userId: 'u1', name: 'Dana Lead', role: 'lead',
            credentials: [cred('Licensed home inspector', 'TX-9001'), cred('InterNACHI CPI', 'N-1')],
        }]))!;
        expect(lead.name).toBe('Dana Lead');
        expect(primaryLicenseOf(lead.credentials)).toBe('TX-9001');
        expect(lead.credentials).toHaveLength(2);
    });
});

/**
 * `primaryLicenseOf` is a free function over a LIST precisely so the live path
 * and the pinned path can apply one rule to two different sources. When it lived
 * inside the DB method, the pinned path could not reach it.
 */
describe('primaryLicenseOf', () => {
    const c = (label: string, memberNumber: string | null) => ({ label, memberNumber, imageUrl: null });

    it('takes the first entry carrying a member number, in order', () => {
        // Order is the inspector's own, and the backfill seeds the licence at
        // sort_order -1 — which is why "first" means "the licence".
        expect(primaryLicenseOf([
            c('Licensed home inspector', 'TX-9001'),
            c('InterNACHI CPI', 'N-1'),
        ])).toBe('TX-9001');
    });

    it('skips entries with no number — a badge image is not a licence', () => {
        expect(primaryLicenseOf([
            c('Association logo', null),
            c('Licensed home inspector', 'TX-9001'),
        ])).toBe('TX-9001');
    });

    it('treats a blank number as absent', () => {
        expect(primaryLicenseOf([c('Licensed home inspector', '   ')])).toBeNull();
    });

    it('returns null for an empty list, so the caller omits the line', () => {
        expect(primaryLicenseOf([])).toBeNull();
    });
});
