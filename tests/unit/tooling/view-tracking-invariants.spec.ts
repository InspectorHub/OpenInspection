// The gate that keeps the delivery-confirmation conditions attached to the code
// they govern. The assessment states them in prose
// (`docs/compliance/report-view-lia.md`); this gate requires each one to be
// anchored at the site it governs, so whoever extends this feature is stopped
// by a check rather than expected to have read the prose first.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const run = () => execFileSync('node', ['scripts/check-view-tracking-invariants.mjs'], { encoding: 'utf8' });

describe('view-tracking invariants gate', () => {
    it('prints both numbers, so a green run is checkable', () => {
        const out = run();
        expect(out).toMatch(/\[view-invariants\] \d+ condition\(s\) declared, \d+ anchored in code/);
    });

    it('finds a non-zero number of conditions', () => {
        const [, declared] = /(\d+) condition\(s\) declared/.exec(run()) ?? [];
        expect(Number(declared), 'zero declared conditions reads as green while checking nothing').toBeGreaterThan(0);
    });

    it('anchors every declared condition — the positive control for the count above', () => {
        const [, declared, anchored] = /(\d+) condition\(s\) declared, (\d+) anchored in code/.exec(run()) ?? [];
        expect(Number(anchored)).toBe(Number(declared));
    });
});
