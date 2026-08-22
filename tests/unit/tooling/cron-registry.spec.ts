/**
 * Invariants for the cron job registry.
 *
 * The registry is the only place that says which jobs exist, which trigger
 * fires them and which deployment modes run them. A typo here is a background
 * job that silently never runs — the exact failure this refactor exists to
 * remove — so it is checked rather than trusted.
 */
import { describe, it, expect } from 'vitest';
import { CRON_JOBS, TICK, DAILY_03, DAILY_04 } from '../../../server/cron/registry';

describe('cron registry', () => {
    // The list the pre-refactor scheduled() ran, in order — blocks 1, 2, 3a,
    // 3, 4, 5, 5a-bis, 5b, 5c, 5d, 6, 6b, 7. Checked against the registry
    // rather than retyped from memory at review time.
    const LEGACY = [
        'agreement-expiry', 'qbo-cdc', 'reminder-enqueue', 'automation-flush',
        'portal-outbox', 'pending-attachments', 'report-generation',
        'orphan-media', 'managed-compliance', 'calendar-sync',
        'retention-agreements', 'retention-logs', 'r2-usage',
    ];

    /**
     * Jobs added after the refactor. This list is the ratchet: a new job must be
     * named here as well as in the registry, so one can never appear by
     * accident. It is SEPARATE from LEGACY because the two claims are different
     * — one is "nothing the old handler ran was lost", the other is "nothing
     * arrived unannounced" — and the single equality that used to carry both
     * reported the second failure using the first one's name.
     */
    const ADDED_SINCE = ['statutory-revision-watch'];

    it('declares every job the monolithic handler used to run, in order', () => {
        const keys = CRON_JOBS.map((j) => j.key);
        expect(keys.filter((k) => LEGACY.includes(k))).toEqual(LEGACY);
    });

    it('has no job that is neither a legacy job nor a declared addition', () => {
        const keys = CRON_JOBS.map((j) => j.key);
        expect(keys.filter((k) => !LEGACY.includes(k) && !ADDED_SINCE.includes(k))).toEqual([]);
        // Positive control: the filter really can produce a name, so an empty
        // result above means the registry is clean and not that the predicate
        // never matches anything.
        expect([...keys, 'ghost-job'].filter((k) => !LEGACY.includes(k) && !ADDED_SINCE.includes(k)))
            .toEqual(['ghost-job']);
    });

    it('has unique keys', () => {
        const keys = CRON_JOBS.map((j) => j.key);
        expect(keys.length, `duplicate key in ${keys.join(',')}`).toBe(new Set(keys).size);
    });

    it('gives every job a known trigger', () => {
        for (const j of CRON_JOBS) {
            expect([TICK, DAILY_03, DAILY_04], `${j.key} has trigger "${j.trigger}"`).toContain(j.trigger);
        }
    });

    it('puts the two once-a-day jobs on their own triggers, not on the 5-minute tick', () => {
        // These used to run inside `if (getUTCHours() === 3)` at the END of a
        // thirteen-job serial chain: one qualifying tick per day, in the position
        // most likely to be cut off. That is why they get their own expression.
        expect(CRON_JOBS.find((j) => j.key === 'r2-usage')?.trigger).toBe(DAILY_03);
        expect(CRON_JOBS.find((j) => j.key === 'retention-logs')?.trigger).toBe(DAILY_04);
    });

    it('marks the SaaS-only jobs so standalone does not probe for work it cannot do', () => {
        expect(CRON_JOBS.find((j) => j.key === 'portal-outbox')?.modes).toEqual(['saas']);
        // Everything else runs in both modes. Standalone gating that depends on
        // a binding or a secret stays inside the job's own probe(), not here:
        // `modes` is about topology, not configuration.
        const bothCount = CRON_JOBS.filter((j) => j.modes.includes('standalone')).length;
        expect(bothCount, `${bothCount} of ${CRON_JOBS.length} jobs run in standalone`).toBe(CRON_JOBS.length - 1);
    });

    it('gives every job a probe and a bounded run', () => {
        for (const j of CRON_JOBS) {
            expect(typeof j.probe, `${j.key}.probe`).toBe('function');
            expect(typeof j.run, `${j.key}.run`).toBe('function');
            expect(j.maxBatch, `${j.key}.maxBatch`).toBeGreaterThan(0);
        }
    });

    it('registers a non-empty list', () => {
        // A registry that read as empty would satisfy every `for (const j of ...)`
        // assertion above without checking anything. Zero is a failure, not a pass.
        expect(CRON_JOBS.length, 'the registry declares no jobs at all').toBeGreaterThan(0);
    });
});
