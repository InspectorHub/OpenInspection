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
import { pinnedLeadCredentials, type Snapshot } from '../../../server/lib/version-diff';

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
 * Which credentials a pinned read renders.
 *
 * NULL AND `[]` ARE DIFFERENT ANSWERS, and conflating them is the whole hazard:
 * one means "this report predates the capture, live state is all there is", the
 * other means "the inspector held none on publish day". As JSON they look
 * identical; on a cover page they are opposites, and the wrong one either hides
 * a badge a document carried or resurrects one it never did.
 */
describe('pinnedLeadCredentials', () => {
    const cred = (label: string) => ({ label, memberNumber: null, imageUrl: null });
    const snap = (inspectors?: Snapshot['inspectors']): Snapshot =>
        ({ data: {}, units: [], ...(inspectors ? { inspectors } : {}) });

    it('returns null when nothing is pinned at all', () => {
        expect(pinnedLeadCredentials(null)).toBeNull();
        expect(pinnedLeadCredentials(undefined)).toBeNull();
    });

    it('returns null for a v1 snapshot, so live fills in', () => {
        // Those reports WERE rendered live when they were delivered. Serving an
        // empty strip instead would be inventing history, not recording it.
        expect(pinnedLeadCredentials(snap())).toBeNull();
    });

    it('returns an EMPTY LIST when the lead held none — not null', () => {
        // The distinction that stops live state leaking back into a frozen
        // document. `?? live` on a null is the fallback; `?? live` on `[]` is not.
        const out = pinnedLeadCredentials(snap([
            { userId: 'u1', name: 'Dana', role: 'lead', credentials: [] },
        ]));
        expect(out).toEqual([]);
        expect(out).not.toBeNull();
    });

    it('renders the LEAD only, whatever order the inspectors are in', () => {
        const out = pinnedLeadCredentials(snap([
            { userId: 'u2', name: 'Sam', role: 'helper', credentials: [cred('Helper cert')] },
            { userId: 'u1', name: 'Dana', role: 'lead', credentials: [cred('Lead cert')] },
        ]));
        // Option A. Pooling both would put an unattributed claim on the cover
        // that neither person made.
        expect(out!.map((c) => c.label)).toEqual(['Lead cert']);
    });

    it('falls back to the first inspector when no one is marked lead', () => {
        const out = pinnedLeadCredentials(snap([
            { userId: 'u2', name: 'Sam', role: 'helper', credentials: [cred('Only cert')] },
        ]));
        expect(out!.map((c) => c.label)).toEqual(['Only cert']);
    });

    it('survives an inspectors array that is present but empty', () => {
        expect(pinnedLeadCredentials(snap([]))).toEqual([]);
    });
});
