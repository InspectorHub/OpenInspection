/**
 * The legacy agent-view-token path must not persist a live credential.
 *
 * `resolveBuilderAccess` used to set `creator.ref` to the raw KV share token,
 * so `repair_requests.created_by_ref` held a working 30-day report credential
 * in plaintext — and that column is rendered verbatim to staff by the
 * inspector portal's repair log. This pins the replacement.
 *
 * The expected digests below are LITERALS computed out of band with node's
 * `crypto.createHash('sha256')`, not with the helper the code under test uses.
 * A test that hashed with `hashToken` would agree with any hasher the
 * implementation happened to pick, including a wrong one.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/public-access', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/public-access')>();
    return {
        ...actual,
        resolveOwnerPreviewFull: vi.fn().mockResolvedValue(null),
        resolveAgentSession: vi.fn().mockResolvedValue(null),
    };
});

// Import AFTER mock registration
// eslint-disable-next-line import/order
import { makeServices, buildApp } from '../helpers/repair-builder-routes-harness';

/** A share token of the real shape: 32 hex of tenant id + 32 hex of random. */
const TOKEN_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const TOKEN_B = 'ffffffffffffffffffffffffffffffffdeadbeefdeadbeefdeadbeefdeadbeef';

/** SHA-256 hex, computed out of band. See the file header. */
const SHA_A = '79175e70eb2236876b0c003be58294690c0e36b44c0947ae80f599ea9d039833';
const SHA_B = 'cacf074c7fea9e90c39b8e4102b7507a8eeb1a68dce150526d70dbf81a0fd934';

type Creator = { kind: string; ref: string };

/**
 * Drives POST /repair-builder/:tenant/:id (create a list) through the legacy
 * KV-token path and returns the Creator the service was asked to persist.
 */
async function creatorPersistedFor(token: string): Promise<Creator> {
    const resolveAgentViewToken = vi.fn().mockResolvedValue({
        inspectionId: 'insp1',
        tenantId:     't2',
    });
    const create = vi.fn().mockResolvedValue({ id: 'rr1', shareToken: 'tok-share' });

    const { app } = buildApp({
        services: makeServices({ resolveAgentViewToken, create }),
        reportStatus: 'published',
        enableCustomerRepairExport: true,
    });

    const res = await app.request(
        `/api/public/repair-builder/t2/insp1?token=${token}`,
        { method: 'POST' },
    );
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    return create.mock.calls[0][2] as Creator;
}

describe('legacy agent-view-token path — what lands in created_by_ref', () => {
    it('stores a non-replayable digest of the share token, never the token', async () => {
        const creator = await creatorPersistedFor(TOKEN_A);

        // POSITIVE CONTROL: something real is still recorded. A change that
        // stopped writing a ref at all, or wrote an empty string, fails here
        // before the negative assertions below can pass vacuously.
        expect(creator.kind).toBe('agent');
        expect(typeof creator.ref).toBe('string');
        expect(creator.ref.length).toBeGreaterThan(32);

        // THE ASSERTION: the credential is not in the column, in any form.
        expect(creator.ref).not.toBe(TOKEN_A);
        expect(creator.ref).not.toContain(TOKEN_A);

        // And it is exactly the value we meant to store.
        expect(creator.ref).toBe(`legacy-share:${SHA_A}`);
    });

    it('gives two different share links two different refs', async () => {
        // A constant "some agent we could not identify" marker would merge the
        // two: `listMine` / `assertCanEdit` key on (tenant, inspection, kind,
        // ref), so two agents holding DIFFERENT legacy links to the same
        // inspection would gain read and write over each other's lists.
        const a = await creatorPersistedFor(TOKEN_A);
        const b = await creatorPersistedFor(TOKEN_B);

        expect(a.ref).toBe(`legacy-share:${SHA_A}`);
        expect(b.ref).toBe(`legacy-share:${SHA_B}`);
        expect(a.ref).not.toBe(b.ref);
    });

    it('gives the same share link the same ref every time', async () => {
        // Ownership continuity: the agent who comes back on the same live link
        // must still match the list they built. A random or time-based ref
        // would satisfy "not the token" and silently orphan every list.
        const first = await creatorPersistedFor(TOKEN_A);
        const second = await creatorPersistedFor(TOKEN_A);
        expect(first.ref).toBe(second.ref);
    });
});
