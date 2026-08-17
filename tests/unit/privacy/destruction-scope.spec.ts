/**
 * `completed` and `certifiable` are two questions, and this file exists to keep
 * them apart.
 *
 * A record written before Durable Objects were purgeable says `completed`
 * truthfully: that purge finished everything it set out to do. It cannot
 * support a certification whose scope includes those objects, because it never
 * measured them. That is not a failed destruction — it is a narrower one, and
 * review requires the difference to be visible rather than inferred.
 */
import { describe, it, expect } from 'vitest';
import {
    DESTRUCTION_RECORD_GENERATION,
    STORES_MEASURED,
    isCertifiableAtCurrentScope,
    type DestructionScopeView,
} from '../../../server/lib/compliance/destruction-scope';

const allComplete = () => Object.fromEntries(STORES_MEASURED.map((s) => [s, 'complete']));

const current = (over: Partial<DestructionScopeView> = {}): DestructionScopeView => ({
    recordVersion: DESTRUCTION_RECORD_GENERATION,
    status: 'completed',
    storesMeasured: [...STORES_MEASURED],
    storeResults: allComplete(),
    ...over,
});

/** What a row written before any of this existed actually looks like. */
const generationOne: DestructionScopeView = {
    recordVersion: 1,
    status: 'completed',
    storesMeasured: null,
    storeResults: null,
};

describe('destruction record generations', () => {
    it('a generation-1 record is completed and NOT certifiable at the current scope', () => {
        expect(generationOne.status).toBe('completed');
        expect(isCertifiableAtCurrentScope(generationOne)).toBe(false);
    });

    it('a current-generation record covering every measured store is certifiable', () => {
        expect(isCertifiableAtCurrentScope(current())).toBe(true);
    });

    it('a current-generation record missing one store is NOT certifiable', () => {
        expect(isCertifiableAtCurrentScope(current({
            storesMeasured: STORES_MEASURED.slice(1),
        }))).toBe(false);
    });

    it('a record still at started is not certifiable however wide its scope', () => {
        expect(isCertifiableAtCurrentScope(current({ status: 'started' }))).toBe(false);
    });

    it('a store that reported incomplete defeats certification, even at full scope', () => {
        // This is the case the plan would have expressed as a `failed` status.
        // The status axis deliberately has only `started` and `completed` — a
        // purge cannot report its own failure, because the failures worth
        // recording are the ones that stop it running at all. So the purge DID
        // finish, and the per-store result is where "we could not verify one of
        // them" lives. Folding it back into `status` would recreate exactly the
        // conflation this module exists to prevent.
        expect(isCertifiableAtCurrentScope(current({
            storeResults: { ...allComplete(), durable_objects: 'incomplete' },
        }))).toBe(false);
    });

    it('a record with the right scope but no per-store results is NOT certifiable', () => {
        // Absence of a result is not a passing result. A row that lists four
        // measured stores and reports on none of them proves nothing, and
        // treating an empty object as "all clear" is how a certification comes
        // to rest on a row nobody wrote.
        expect(isCertifiableAtCurrentScope(current({ storeResults: {} }))).toBe(false);
        expect(isCertifiableAtCurrentScope(current({ storeResults: null }))).toBe(false);
    });

    it('a future generation is not certifiable under today\'s rules either', () => {
        // The check is equality, not >=. A record written by a newer deployment
        // measured a universe this code cannot enumerate, so this code is not
        // the one that can judge it.
        expect(isCertifiableAtCurrentScope(current({
            recordVersion: DESTRUCTION_RECORD_GENERATION + 1,
        }))).toBe(false);
    });
});
