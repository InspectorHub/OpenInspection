/**
 * Reading the document back out of storage is not a change to it.
 *
 * `hydrate()` runs inside `blockConcurrencyWhile` in the CONSTRUCTOR, so it runs
 * on every reconstruction after hibernation. It used to apply the stored update
 * with no origin, which fired `doc.on('update')`, and the observer treated it as
 * an edit — scheduling a persist back into the storage it had just been read
 * from, arming a one-second storage alarm, and counting toward the auto-snapshot
 * cadence.
 *
 * The alarm is the part that made it self-sustaining rather than merely wasteful:
 * the alarm wakes the DO, the constructor hydrates, hydration arms another alarm.
 * Measured in production over 24h on a deployment with no editing activity:
 * 7,015 alarm invocations against 1,284 fetches, across ten documents.
 *
 * ⚠️ Every assertion here is PAIRED with a real edit doing the same thing. An
 * observer that had simply stopped working would satisfy "hydration arms no
 * alarm" perfectly, and that is the one regression this file must not sleep
 * through — so the positive control is not optional decoration.
 *
 * ⚠️ AND THE FIRST VERSION OF THIS FILE WAS VACUOUS, which is worth recording
 * because the shape recurs. It called `hydrate()` on the live DO and asserted no
 * alarm — and passed with the fix reverted. The reason: the live doc ALREADY
 * holds the state being read back, and applying an update Yjs already has is a
 * no-op that fires no `update` event at all. So the test proved nothing about
 * origins; it proved that hydrating twice changes nothing.
 *
 * Reaching the defect needs the observer attached to a doc that does NOT yet have
 * the state — which is exactly the situation a hibernation reconstruction creates
 * and the one the harness will not create on its own. Hence `freshDocWithObserver`
 * below. The lesson generalises: a green assertion about an event that never fired
 * is indistinguishable from a green assertion about an event that fired correctly.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { INSPECTION_RESULTS_TEST_DDL } from '../helpers/inline-ddl';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';
import { seedResultsDoc, applyItemPatch } from '../../server/lib/collab/results-doc';

const b = env as unknown as {
    DB: D1Database;
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
};

const TENANT = 'tenant-hydrate-origin';
const FINDING_KEY = '_default:sec1:item1';

interface DOInternals {
    doc: Y.Doc;
    tenantId: string | null;
    inspectionId: string | null;
    updatesSinceSnapshot: number;
    /** The stable bound observer the constructor attaches. */
    onDocUpdate: (update: Uint8Array, origin: unknown) => void;
    persist(): Promise<void>;
    hydrate(): Promise<void>;
}

/**
 * Put the DO into the state a hibernation reconstruction leaves it in: an EMPTY
 * doc with the real observer attached, so a hydrate genuinely applies an update
 * the doc does not already have.
 *
 * Without this the hydrate is a Yjs no-op and fires nothing — see the file header.
 * The observer attached is `onDocUpdate` itself, not a stand-in, because the whole
 * question is what that function does with the origin it is handed.
 */
function freshDocWithObserver(o: DOInternals): void {
    o.doc = new Y.Doc();
    o.doc.on('update', o.onDocUpdate);
}

describe('hydration is not an edit', () => {
    beforeAll(async () => {
        await b.DB.exec(INSPECTION_RESULTS_TEST_DDL);
    });

    beforeEach(async () => {
        await b.DB.exec('DELETE FROM inspection_results;');
    });

    /** A fresh document with one rated item already persisted to DO storage. */
    async function withStoredState(name: string) {
        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(name));
        await runInDurableObject(stub, async (inst, state) => {
            const o = inst as unknown as DOInternals;
            o.tenantId = TENANT;
            o.inspectionId = name;
            seedResultsDoc(o.doc, [{ findingKey: FINDING_KEY }]);
            applyItemPatch(o.doc, FINDING_KEY, 'rating', 'satisfactory');
            await o.persist();
            // Clear whatever the seeding edits armed, so the next assertion is
            // about the call under test and not about leftovers.
            await state.storage.deleteAlarm();
        });
        return stub;
    }

    it('a real edit DOES arm the persist alarm', async () => {
        // The positive control, and it runs first on purpose: if this ever fails,
        // every "hydration arms nothing" assertion below is meaningless.
        const stub = await withStoredState('insp-control');
        await runInDurableObject(stub, async (inst, state) => {
            expect(await state.storage.getAlarm()).toBeNull();

            applyItemPatch((inst as unknown as DOInternals).doc, FINDING_KEY, 'rating', 'marginal');

            expect(await state.storage.getAlarm()).not.toBeNull();
        });
    });

    it('hydrating into a reconstructed doc arms no alarm', async () => {
        const stub = await withStoredState('insp-hydrate-alarm');
        await runInDurableObject(stub, async (inst, state) => {
            const o = inst as unknown as DOInternals;
            freshDocWithObserver(o);
            expect(await state.storage.getAlarm()).toBeNull();

            await o.hydrate();

            // The defect: this was non-null, and the alarm it armed woke the DO,
            // whose constructor hydrated again.
            expect(await state.storage.getAlarm()).toBeNull();
            // Paired, in the same test: the observer really is attached and really
            // does arm on a genuine edit. Without this the assertion above passes
            // just as well on a doc nobody is watching.
            applyItemPatch(o.doc, FINDING_KEY, 'rating', 'marginal');
            expect(await state.storage.getAlarm()).not.toBeNull();
        });
    });

    it('hydrating does not count toward the auto-snapshot cadence', async () => {
        const stub = await withStoredState('insp-hydrate-count');
        await runInDurableObject(stub, async (inst) => {
            const o = inst as unknown as DOInternals;
            freshDocWithObserver(o);
            const before = o.updatesSinceSnapshot;

            await o.hydrate();
            expect(o.updatesSinceSnapshot, 'hydration is not an update').toBe(before);

            // Paired control in the same test, because "the counter never moves"
            // and "the counter is not wired up" look identical from one side.
            applyItemPatch(o.doc, FINDING_KEY, 'rating', 'poor');
            expect(o.updatesSinceSnapshot, 'a real edit still counts').toBeGreaterThan(before);
        });
    });

    it('hydration still actually loads the state — it is skipped, not neutered', async () => {
        // The failure this catches: "fixing" the loop by not applying the stored
        // update at all. The DO would arm no alarm and also hold no document,
        // and every assertion above would pass.
        const stub = await withStoredState('insp-hydrate-loads');
        await runInDurableObject(stub, async (inst) => {
            const o = inst as unknown as DOInternals;
            // A fresh doc with nothing in it, then hydrate into it.
            o.doc = new Y.Doc();
            expect(Y.encodeStateAsUpdate(o.doc).byteLength).toBeLessThan(10);

            await o.hydrate();

            expect(Y.encodeStateAsUpdate(o.doc).byteLength).toBeGreaterThan(10);
        });
    });
});
