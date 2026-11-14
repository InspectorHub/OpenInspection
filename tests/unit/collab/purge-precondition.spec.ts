import { describe, expect, it } from 'vitest';
import { PURGE_IF_IDLE_HEADER, PURGE_IF_SNAPSHOTS_HEADER, PURGE_IF_YDOC_HEADER, purgeDigest, purgePrecondition, purgeSnapshotsDigest } from '../../../server/durable-objects/purge-path';

const req = (headers: Record<string, string>) => new Request('https://do.local/purge', { method: 'POST', headers });
const BYTES = new Uint8Array([1, 2, 3]);
const SNAPS = [{ seq: 1, atMs: 5, byUserId: null, projection: { a: 1 } }];
const HEX = 'a'.repeat(64);

describe('purgePrecondition', () => {
    it('a header that is present but malformed is refused (bad-precondition), never read as no precondition', async () => {
        const read = async () => ({ ydoc: BYTES, snapshots: SNAPS });
        const malformed: Array<Record<string, string>> = [{ [PURGE_IF_IDLE_HEADER]: '0' }, { [PURGE_IF_IDLE_HEADER]: '' }, { [PURGE_IF_IDLE_HEADER]: 'true' }, { [PURGE_IF_YDOC_HEADER]: '' }, { [PURGE_IF_YDOC_HEADER]: 'XYZ' }, { [PURGE_IF_SNAPSHOTS_HEADER]: 'abc' }];
        for (const headers of malformed) {
            expect(await purgePrecondition(req(headers), () => false, read)).toBe('bad-precondition');
        }
        expect(await purgePrecondition(req({}), () => true, read)).toBeNull(); // control: no headers, unconditional
        expect(await purgePrecondition(req({ [PURGE_IF_IDLE_HEADER]: '1' }), () => false, read)).toBeNull();
    });

    it('the snapshot digest ignores key order (a JSON round trip) but not content, and none equals an empty list', async () => {
        const reordered = [{ projection: { a: 1 }, byUserId: null, atMs: 5, seq: 1 }];
        expect(await purgeSnapshotsDigest(reordered)).toBe(await purgeSnapshotsDigest(SNAPS));
        expect(await purgeSnapshotsDigest([{ ...SNAPS[0], atMs: 6 }])).not.toBe(await purgeSnapshotsDigest(SNAPS));
        expect(await purgeSnapshotsDigest(undefined)).toBe(await purgeSnapshotsDigest([]));
    });

    it('answers changed for a stale document or stale restore points, and null when both match', async () => {
        const headers = { [PURGE_IF_YDOC_HEADER]: await purgeDigest(BYTES), [PURGE_IF_SNAPSHOTS_HEADER]: await purgeSnapshotsDigest(SNAPS) };
        expect(await purgePrecondition(req(headers), () => false, async () => ({ ydoc: BYTES, snapshots: SNAPS }))).toBeNull();
        expect(await purgePrecondition(req(headers), () => false, async () => ({ ydoc: new Uint8Array([1, 2]), snapshots: SNAPS }))).toBe('changed');
        expect(await purgePrecondition(req(headers), () => false, async () => ({ ydoc: BYTES, snapshots: [...SNAPS, { ...SNAPS[0], seq: 2 }] }))).toBe('changed');
        expect(await purgePrecondition(req({ [PURGE_IF_YDOC_HEADER]: HEX }), () => false, async () => ({ ydoc: undefined, snapshots: [] }))).toBe('changed');
    });

    it('reads storage again after the digest and refuses when the second read differs, and tests liveness only after that', async () => {
        const headers = { [PURGE_IF_YDOC_HEADER]: await purgeDigest(BYTES), [PURGE_IF_IDLE_HEADER]: '1' };
        const log: string[] = [];
        let calls = 0;
        const read = async () => { calls++; log.push('read'); return { ydoc: calls === 1 ? BYTES : new Uint8Array([9]), snapshots: [] }; };
        expect(await purgePrecondition(req(headers), () => { log.push('live'); return false; }, read)).toBe('changed');
        expect(log).toEqual(['read', 'read']);
        log.length = 0;
        const steady = async () => { log.push('read'); return { ydoc: BYTES, snapshots: [] }; };
        expect(await purgePrecondition(req(headers), () => { log.push('live'); return true; }, steady)).toBe('live');
        expect(log).toEqual(['read', 'read', 'live']);
    });
});
