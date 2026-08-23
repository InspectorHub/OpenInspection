/**
 * Every state a run can be in has a name and a colour of its own.
 *
 * This file exists because of the failure mode the module it tests describes
 * and cannot prevent by itself: both lookups FALL BACK rather than throw, so a
 * state left out of a table does not break — it renders as a different state.
 * A run we declined would come back reading "Ready to review", which is not a
 * degraded label, it is the opposite of what happened.
 *
 * So the assertion is structural, against `MIGRATION_BATCH_STATUSES` itself.
 * Rendering each state and reading the result would pass on exactly the input
 * that is wrong, because the wrong answer is a valid label.
 *
 * Both numbers are printed on both directions: the states with no entry AND
 * the states with one. A list of misses alone reads green when the axis is
 * empty, or when the import that supplies it silently resolves to nothing.
 */
import { describe, expect, it } from 'vitest';

import { MIGRATION_BATCH_STATUSES } from '../../server/lib/status/migration-batch-status';

import { STATUS_LABEL, STATUS_TONE, importStatusLabel, importStatusTone } from './import-run-labels';

describe('import run status vocabulary', () => {
    it('names every state on the batch lifecycle axis', () => {
        const axis = [...MIGRATION_BATCH_STATUSES];
        const named = axis.filter((s) => s in STATUS_LABEL);
        const unnamed = axis.filter((s) => !(s in STATUS_LABEL));

        expect(unnamed).toEqual([]);
        // The positive control. Without it the line above passes on an empty
        // axis, and an axis that arrived empty is the same bug one import up.
        expect(named).toHaveLength(axis.length);
        expect(axis.length).toBeGreaterThan(0);
    });

    it('gives every state on the axis a tone of its own', () => {
        const axis = [...MIGRATION_BATCH_STATUSES];
        const toned = axis.filter((s) => s in STATUS_TONE);
        const untoned = axis.filter((s) => !(s in STATUS_TONE));

        expect(untoned).toEqual([]);
        expect(toned).toHaveLength(axis.length);
        expect(axis.length).toBeGreaterThan(0);
    });

    it('never gives two states the same words', () => {
        // The consequence of a missing entry, stated as the thing a reader
        // would actually notice: two states that read identically. A label
        // taken from the fallback is a duplicate of `staged`'s.
        const labels = [...MIGRATION_BATCH_STATUSES].map((s) => [s, importStatusLabel(s)] as const);
        const seen = new Map<string, string>();
        const collisions: string[] = [];
        for (const [status, label] of labels) {
            const first = seen.get(label);
            if (first !== undefined) collisions.push(`${status} reads the same as ${first}`);
            else seen.set(label, status);
        }

        expect(collisions).toEqual([]);
        expect(seen.size).toBe(labels.length);
    });

    it('still answers for a state it has never heard of', () => {
        // The fallback is deliberate and must stay: a run stored before a state
        // existed has to render. What must not happen is a state that IS on the
        // axis reaching it, which the tests above are what prevent.
        expect(importStatusLabel('a_state_from_the_future')).toBe(importStatusLabel('staged'));
        expect(importStatusTone('a_state_from_the_future')).toBe('info');
    });
});
