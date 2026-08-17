/**
 * The standalone tenant id, and its fallback, are decided in one place.
 *
 * `getDeploymentProfile` resolves `SINGLE_TENANT_ID ?? FIXED_TENANT_FALLBACK`
 * and hands it back as `profile.fixedTenantId`. Two handlers in `server/api/
 * auth.ts` re-implemented that expression inline, all-zero UUID included — so
 * the repo held three copies of the literal answering two questions, and
 * changing the fallback would have needed someone to remember both of the
 * copies that do not live next to the constant.
 *
 * Asserted on source text rather than behaviour on purpose: the copies AGREED.
 * No runtime test could tell them apart, which is exactly why they survived.
 * The general form of this check is the `deployment-profile` literal rule in
 * `scripts/check-mode-disguises.mjs`; this spec is the specific case that
 * motivated it and fails faster.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const FIXED_TENANT_LITERAL = '00000000-0000-0000-0000-000000000000';
/** The one file allowed to spell it: where the constant is declared. */
const OWNER = 'server/lib/deployment-profile.ts';

function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${entry}`;
        if (statSync(join(ROOT, rel)).isDirectory()) sourceFiles(rel, acc);
        else if (rel.endsWith('.ts') || rel.endsWith('.tsx')) acc.push(rel);
    }
    return acc;
}

describe('the fixed tenant id has exactly one source', () => {
    it('spells the all-zero UUID in one server file and no other', () => {
        const files = sourceFiles('server');
        const holders = files.filter((f) => readFileSync(join(ROOT, f), 'utf8').includes(FIXED_TENANT_LITERAL));

        // Both numbers, always: "no violations" out of a scan that found no
        // files is not a pass, it is a broken scan.
        expect(files.length, 'scanned no server sources — the walk is broken').toBeGreaterThan(100);
        expect(holders).toEqual([OWNER]);
    });

    it('resolves the fallback through the profile, so it is one decision', () => {
        // The positive control for the text assertion above. Deleting the
        // constant entirely would satisfy that one; this pins that the value
        // still resolves, and resolves from the profile.
        const owner = readFileSync(join(ROOT, OWNER), 'utf8');
        expect(owner).toContain('FIXED_TENANT_FALLBACK');
        expect(owner).toContain('env.SINGLE_TENANT_ID ?? FIXED_TENANT_FALLBACK');
    });
});
