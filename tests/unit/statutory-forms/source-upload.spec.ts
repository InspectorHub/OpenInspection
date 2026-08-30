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
            effectiveUntil: null, withdrawn: null,
            sourceUrl: 'https://example.gov/forms/flat.pdf',
            // sha256 of the ASCII bytes `the authority's own document`.
            sourceHash: 'f923931bf70ee0e62d518fcd562719157b3b1fef9efe8fd4eb2b97485ad6505b',
            publishedBy: 'a.operator', publishedAt: Date.UTC(2026, 0, 1),
        },
        {
            formId: 'yy_flat_form', version: 'Rev. 01/25',
            effectiveFrom: Date.UTC(2025, 0, 1), mandatoryFrom: Date.UTC(2025, 0, 1),
            effectiveUntil: Date.UTC(2026, 0, 1),
            // Withdrawn, and still uploadable on purpose -- see the pair below.
            withdrawn: { at: Date.UTC(2026, 1, 1), reason: 'authority_withdrew' },
            sourceUrl: 'https://example.gov/forms/flat-old.pdf',
            // sha256 of the ASCII bytes `the superseded revision's own document`.
            sourceHash: '18e173eaf3335547153482d233f83245f3eca0b4d7491cd4efffcab103dfaac3',
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

/** The withdrawn revision, and the bytes it really does record. */
const OLD_REVISION = 'Rev. 01/25';
const OLD_KEY = `_platform/statutory-forms/${FORM}/${encodeURIComponent(OLD_REVISION)}.pdf`;
const OLD_BYTES = new TextEncoder().encode("the superseded revision's own document");

async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let put: Array<{ key: string; size: number }>;

/**
 * Which keys the fake bucket claims to be holding. Empty by default so the
 * upload tests below are unaffected; the listing tests fill it, and they fill
 * it with ONE of the two revisions on purpose — see the pair in that describe.
 */
let stored: Map<string, { size: number; uploaded: Date }>;

function bucket(): R2Bucket {
    return {
        put: async (key: string, value: ArrayBuffer | Uint8Array) => {
            put.push({ key, size: (value as Uint8Array).byteLength });
            return null;
        },
        // `head`, never `get`: the listing needs one bit plus the object's own
        // metadata, and a stub that served bytes would let an implementation
        // reading whole PDFs pass unnoticed.
        head: async (key: string) => stored.get(key) ?? null,
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
    stored = new Map();
});

describe('POST /api/admin/statutory-forms/{formId}/source', () => {
    it('both fixture revisions really do name the sha256 of their own bytes', async () => {
        // The instrument check. If the fixture hash and the fixture bytes ever
        // drifted apart, "accepts the right bytes" below would fail for a reason
        // that has nothing to do with the handler, and "refuses the wrong bytes"
        // would pass for a reason that has nothing to do with it either.
        const declared = PUBLISHED_FORM_VERSIONS.find((v) => v.version === REVISION);
        expect(declared?.sourceHash).toBe(await sha256(RIGHT_BYTES));
        const withdrawn = PUBLISHED_FORM_VERSIONS.find((v) => v.version === OLD_REVISION);
        expect(withdrawn?.sourceHash).toBe(await sha256(OLD_BYTES));
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

    it('accepts a WITHDRAWN revision whose bytes match, because re-issuing an old report needs them', async () => {
        // A revision is withdrawn to stop NEW production. The documents already
        // produced from it are in other people's hands, and re-issuing one reads
        // these exact bytes -- so refusing the upload would make the withdrawal
        // destroy the thing it was careful not to touch.
        //
        // ⚠️ This assertion used to be `status === 400`, under this same title.
        // The upload was refused on the HASH -- the test posted bytes that were
        // not the withdrawn revision's -- so a handler that rejected every
        // withdrawn revision outright would have passed it, and the file's one
        // claim about withdrawals was tested by nothing.
        const res = await post(OLD_BYTES, { revision: OLD_REVISION });
        expect(res.status).toBe(200);
        expect(put).toEqual([{ key: OLD_KEY, size: OLD_BYTES.byteLength }]);
    });

    it('refuses a withdrawn revision on the HASH, and says nothing about the withdrawal', async () => {
        // The negative half of the pair above. The hash is the only reason an
        // upload may fail, and the message has to lead somewhere: an operator
        // told "withdrawn" would go looking for a policy problem instead of the
        // right file.
        const old = PUBLISHED_FORM_VERSIONS[1];
        const bytes = new Uint8Array(32);
        expect(await sha256(bytes)).not.toBe(old?.sourceHash);

        const res = await post(bytes, { revision: OLD_REVISION });
        expect(res.status).toBe(400);
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toContain(OLD_REVISION);
        expect(body.error.message).not.toMatch(/withdrawn/i);
        expect(put).toEqual([]);
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

/**
 * The read that has to exist before the upload above can be reached by anybody.
 *
 * The upload takes a revision label the caller already knows, and nobody knows
 * one: the labels are the authority's own and which of them a build publishes
 * is decided by what is compiled in. So this endpoint is the only thing that
 * can put a real label in front of an operator, and the assertions below are
 * about the two facts a screen cannot invent — WHICH revisions exist, and
 * WHICH of them this deployment can actually render.
 */
describe('GET /api/admin/statutory-forms', () => {
    interface ListedRevision {
        formId: string;
        revision: string;
        sourceHash: string;
        sourceUrl: string;
        present: boolean;
        sizeBytes: number | null;
        uploadedAt: number | null;
        withdrawn: { at: number; reason: string } | null;
    }
    type ListBody = {
        data: { storageBound: boolean; revisions: ListedRevision[] };
    };

    async function list(opts: { role?: string; noBucket?: boolean } = {}) {
        const env = (opts.noBucket ? {} : { PHOTOS: bucket() }) as unknown as HonoConfig['Bindings'];
        return app(opts.role ?? 'owner').request('/api/admin/statutory-forms', {}, env);
    }

    it('lists every revision this software publishes, and no others', async () => {
        // The instrument check first: the catalogue really does hold two, so
        // "returns them all" below is not a claim about a one-element list that
        // any implementation would satisfy.
        expect(PUBLISHED_FORM_VERSIONS).toHaveLength(2);

        const res = await list();
        expect(res.status).toBe(200);
        const body = await res.json() as ListBody;
        expect(body.data.revisions.map((r) => `${r.formId} ${r.revision}`))
            .toEqual([`${FORM} ${REVISION}`, `${FORM} ${OLD_REVISION}`]);
    });

    it('reports presence per revision, with one stored and one not', async () => {
        // THE PAIR. A handler hardcoding `present: false` describes a fresh
        // deployment perfectly and is useless; one hardcoding `true` hides the
        // only fault this screen exists to show. Both halves are asserted in
        // one run, over a bucket holding exactly one of the two keys.
        stored.set(KEY, { size: 620865, uploaded: new Date(Date.UTC(2026, 7, 29)) });

        const body = await (await list()).json() as ListBody;
        const current = body.data.revisions.find((r) => r.revision === REVISION);
        const old = body.data.revisions.find((r) => r.revision === OLD_REVISION);

        expect(current?.present).toBe(true);
        expect(current?.sizeBytes).toBe(620865);
        expect(current?.uploadedAt).toBe(Date.UTC(2026, 7, 29));

        expect(old?.present).toBe(false);
        // Null rather than zero. A stored PDF of zero bytes is not a thing that
        // happens, but "0 B, uploaded 1 Jan 1970" is what a screen prints when
        // absence is spelled as a number.
        expect(old?.sizeBytes).toBeNull();
        expect(old?.uploadedAt).toBeNull();
    });

    it('carries what an upload is checked against, so the operator can check first', async () => {
        const body = await (await list()).json() as ListBody;
        const current = body.data.revisions.find((r) => r.revision === REVISION);
        // The recorded hash and the authority's own address. Without these the
        // screen can say a file is missing but not which file, and the operator
        // is back to guessing among identically named downloads.
        expect(current?.sourceHash).toBe(PUBLISHED_FORM_VERSIONS[0]?.sourceHash);
        expect(current?.sourceUrl).toBe(PUBLISHED_FORM_VERSIONS[0]?.sourceUrl);
    });

    it('reports a withdrawal with its reason, and reports its absence as null', async () => {
        // Two revisions, one withdrawn: the reason decides what the reader does
        // next (wait for us, or move to the revision now in force), so a bare
        // boolean here would be the one-word "withdrawn" that form-registry.ts
        // exists to refuse.
        const body = await (await list()).json() as ListBody;
        expect(body.data.revisions.find((r) => r.revision === OLD_REVISION)?.withdrawn)
            .toEqual({ at: Date.UTC(2026, 1, 1), reason: 'authority_withdrew' });
        expect(body.data.revisions.find((r) => r.revision === REVISION)?.withdrawn).toBeNull();
    });

    it('says storage is bound when it is, and not when it is not', async () => {
        // A deployment with no bucket and a deployment with an empty one both
        // answer `present: false` for every row and are not the same problem:
        // only one of them is fixed by uploading a file. Both directions
        // asserted, because a flag that is always false reads correct on the
        // only screenshot anybody takes.
        expect((await (await list()).json() as ListBody).data.storageBound).toBe(true);

        const unbound = await (await list({ noBucket: true })).json() as ListBody;
        expect(unbound.data.storageBound).toBe(false);
        // And the catalogue is still described. A deployment that cannot store
        // anything still has to be able to see what it is missing.
        expect(unbound.data.revisions).toHaveLength(2);
        expect(unbound.data.revisions.every((r) => r.present === false)).toBe(true);
    });

    it('is closed to a workspace member who is not the owner', async () => {
        // Same guard as the upload. The listing names every revision and its
        // recorded hash, and it is the door to the write next to it.
        expect((await list({ role: 'inspector' })).status).toBe(403);
    });
});
