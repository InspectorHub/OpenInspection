/**
 * The operator hands us the authority's PDF, and we check it is that PDF.
 *
 * Every assertion is on a router that is really mounted, so the guard is really
 * mounted too: `createRoutesStub` does not run middleware, and a role check that
 * is never executed passes every test written against it.
 *
 * The two hash tests are a PAIR. A handler that rejected every upload would
 * satisfy "refuses the wrong bytes" perfectly, so "accepts the right bytes"
 * sits beside it and is not optional.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';

/**
 * The published catalogue is EMPTY by declaration -- no statutory form ships
 * with this software -- so the upload has nothing to verify against unless a
 * revision is supplied here. Mocked at the module rather than made injectable
 * on the route: an injection seam that exists only for a test is the seam a
 * caller eventually uses to name its own expected hash.
 */
vi.mock('../../../server/lib/statutory/forms', () => ({
    EMPTY_CATALOGUE_REASON: null,
    PUBLISHED_FORM_VERSIONS: [
        {
            formId: 'yy_flat_form', version: 'Rev. 04/26',
            effectiveFrom: Date.UTC(2026, 0, 1), mandatoryFrom: Date.UTC(2026, 0, 1),
            effectiveUntil: null, withdrawnAt: null,
            sourceUrl: 'https://example.gov/forms/flat.pdf',
            // sha256 of the ASCII bytes `the authority's own document`.
            sourceHash: 'f923931bf70ee0e62d518fcd562719157b3b1fef9efe8fd4eb2b97485ad6505b',
            publishedBy: 'a.operator', publishedAt: Date.UTC(2026, 0, 1),
        },
        {
            formId: 'yy_flat_form', version: 'Rev. 01/25',
            effectiveFrom: Date.UTC(2025, 0, 1), mandatoryFrom: Date.UTC(2025, 0, 1),
            effectiveUntil: Date.UTC(2026, 0, 1),
            // Withdrawn, and still uploadable on purpose -- see the test below.
            withdrawnAt: Date.UTC(2026, 1, 1),
            sourceUrl: 'https://example.gov/forms/flat-old.pdf',
            sourceHash: '00'.repeat(32),
            publishedBy: 'a.operator', publishedAt: Date.UTC(2025, 0, 1),
        },
    ],
    FIELD_MAPS: [],
    fieldMapFor: () => null,
}));

import adminStatutorySourceRoutes from '../../../server/api/admin/admin-statutory-source';
import { AppError } from '../../../server/lib/errors';
import { PUBLISHED_FORM_VERSIONS } from '../../../server/lib/statutory/forms';

const FORM = 'yy_flat_form';
const REVISION = 'Rev. 04/26';
const KEY = `_platform/statutory-forms/${FORM}/${encodeURIComponent(REVISION)}.pdf`;

const RIGHT_BYTES = new TextEncoder().encode("the authority's own document");
const WRONG_BYTES = new TextEncoder().encode('a superseded revision of the same form');

async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let put: Array<{ key: string; size: number }>;

function bucket(): R2Bucket {
    return {
        put: async (key: string, value: ArrayBuffer | Uint8Array) => {
            put.push({ key, size: (value as Uint8Array).byteLength });
            return null;
        },
    } as unknown as R2Bucket;
}

function app(role = 'owner') {
    const a = new OpenAPIHono<HonoConfig>();
    a.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', '00000000-0000-0000-0000-0000000000e1');
        await next();
    });
    a.route('/api/admin', adminStatutorySourceRoutes);
    a.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { message: err.message } }, err.status as 400);
        }
        throw err;
    });
    return a;
}

function upload(bytes: Uint8Array, revision = REVISION): FormData {
    const body = new FormData();
    body.append('revision', revision);
    body.append('file', new File([bytes as unknown as BlobPart], 'download.pdf', { type: 'application/pdf' }));
    return body;
}

const ENV = () => ({ PHOTOS: bucket() } as unknown as HonoConfig['Bindings']);

async function post(bytes: Uint8Array, opts: { revision?: string; role?: string } = {}) {
    return app(opts.role ?? 'owner').request(
        `/api/admin/statutory-forms/${FORM}/source`,
        { method: 'POST', body: upload(bytes, opts.revision ?? REVISION) },
        ENV(),
    );
}

beforeEach(() => {
    put = [];
});

describe('POST /api/admin/statutory-forms/{formId}/source', () => {
    it('the fixture revision really does name the sha256 of the right bytes', async () => {
        // The instrument check. If the fixture hash and the fixture bytes ever
        // drifted apart, "accepts the right bytes" below would fail for a reason
        // that has nothing to do with the handler, and "refuses the wrong bytes"
        // would pass for a reason that has nothing to do with it either.
        const declared = PUBLISHED_FORM_VERSIONS.find((v) => v.version === REVISION);
        expect(declared?.sourceHash).toBe(await sha256(RIGHT_BYTES));
    });

    it('refuses bytes whose sha256 is not the one this revision names', async () => {
        const res = await post(WRONG_BYTES);
        expect(res.status).toBe(400);
        const body = await res.json() as { error: { message: string } };
        const message = body.error.message;

        // Both values, or the operator cannot tell which of several similar PDFs
        // they are holding. "Upload failed" would leave them guessing.
        expect(message).toContain(await sha256(WRONG_BYTES));
        expect(message).toContain(PUBLISHED_FORM_VERSIONS[0]?.sourceHash);
        // And the one instruction that actually resolves it: the revision is
        // printed on the document, and the filename does not carry it.
        expect(message).toMatch(/revision printed on the document/i);
        expect(message).toMatch(/filename/i);
        // Nothing reached the bucket.
        expect(put).toEqual([]);
    });

    it('accepts bytes whose sha256 matches, and stores them under the shared platform key', async () => {
        // The positive control. Without it a handler that rejected everything
        // would satisfy the assertion above and look correct.
        const res = await post(RIGHT_BYTES);
        expect(res.status).toBe(200);
        expect(put).toEqual([{ key: KEY, size: RIGHT_BYTES.byteLength }]);
    });

    it('still accepts a WITHDRAWN revision, because re-issuing an old report needs its bytes', async () => {
        const old = PUBLISHED_FORM_VERSIONS[1];
        // A revision is withdrawn to stop NEW production. The documents already
        // produced from it are in other people's hands, and re-issuing one reads
        // these exact bytes -- so refusing the upload would make the withdrawal
        // destroy the thing it was careful not to touch.
        const bytes = new Uint8Array(32);
        expect(await sha256(bytes)).not.toBe(old?.sourceHash);
        const res = await post(bytes, { revision: 'Rev. 01/25' });
        // It fails on the HASH, which is the only reason an upload may fail --
        // not on the withdrawal.
        expect(res.status).toBe(400);
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toContain('Rev. 01/25');
        expect(body.error.message).not.toMatch(/withdrawn/i);
    });

    it('refuses a revision this software does not publish, rather than storing unverifiable bytes', async () => {
        const res = await post(RIGHT_BYTES, { revision: '9-9' });
        expect(res.status).toBe(404);
        expect(put).toEqual([]);
    });

    it('is closed to a workspace member who is not the owner', async () => {
        const res = await post(RIGHT_BYTES, { role: 'inspector' });
        expect(res.status).toBe(403);
        expect(put).toEqual([]);
    });
});
