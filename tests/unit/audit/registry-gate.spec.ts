/**
 * The audit-registry gate's own self-check.
 *
 * ⚠️ ONE spawn, shared by all three cases. Each `it` used to call `run()`
 * itself, so this file shelled out to a repo-walking script three times for
 * three assertions about the SAME output. Individually each spawn is ~2s
 * against vitest's 5s default, which is fine on an idle machine and is not fine
 * on a busy one: on 2026-09-06 all three timed out during a run that shared the
 * machine with another suite, and the file read as a regression in the gate it
 * was checking. Nothing about the assertions needed three runs.
 *
 * The explicit timeout is belt-and-braces on top: the work here is process
 * startup plus a walk of the repo, and neither belongs to the class of thing a
 * 5s default was chosen for.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it, beforeAll } from 'vitest';

let output = '';

beforeAll(() => {
    output = execFileSync('node', ['scripts/check-audit-registry.mjs'], { encoding: 'utf8' });
}, 60_000);

describe('audit registry gate', () => {
    it('prints both numbers, so a green run is checkable', () => {
        expect(output).toMatch(/\[audit-registry\] \d+ action\(s\) declared, \d+ written at \d+ call site\(s\)/);
    });

    it('found a non-trivial number of call sites — an empty walk reports the same clean result as a correct one', () => {
        const [, sites] = /written at (\d+) call site/.exec(output) ?? [];
        expect(Number(sites)).toBeGreaterThan(80);
    });

    it('reports zero disagreements', () => {
        expect(output).toMatch(/0 undeclared, 0 unreconciled/);
    });
});
