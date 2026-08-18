import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const run = () => execFileSync('node', ['scripts/check-audit-registry.mjs'], { encoding: 'utf8' });

describe('audit registry gate', () => {
    it('prints both numbers, so a green run is checkable', () => {
        expect(run()).toMatch(/\[audit-registry\] \d+ action\(s\) declared, \d+ written at \d+ call site\(s\)/);
    });

    it('found a non-trivial number of call sites — an empty walk reports the same clean result as a correct one', () => {
        const [, sites] = /written at (\d+) call site/.exec(run()) ?? [];
        expect(Number(sites)).toBeGreaterThan(80);
    });

    it('reports zero disagreements', () => {
        expect(run()).toMatch(/0 undeclared, 0 unreconciled/);
    });
});
