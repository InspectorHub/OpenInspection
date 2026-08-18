import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    renderModesTable,
    DOC_PATH,
    START,
    END,
} from '../../../scripts/gen-deployment-modes-doc';
import { STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';

/**
 * The self-hosting docs describe what a standalone install can and cannot do.
 * That description is the capability table in
 * `docs/reference/deployment-modes.md`, generated from the two profile
 * constants by `npm run docs:modes`. This spec is what makes "generated" true:
 * without it the file is just a table someone typed once.
 *
 * It fails in two directions, which is the point:
 *   - a capability's VALUE changes and the doc still shows the old one
 *   - a capability is ADDED with no `DESCRIPTIONS` entry, so the docs never
 *     mention a behaviour that differs between modes
 *
 * The second is the one that actually happens. The doc this replaced named an
 * "Admin" role that does not exist and a field-form route that had been
 * deleted, because nothing ever compared it to the code.
 */
describe('deployment-modes.md is generated from the profile constants', () => {
    /**
     * Carriage returns are stripped from BOTH sides before comparing.
     *
     * The generator writes unix line endings; git checks the file out with
     * windows ones wherever `core.autocrlf` is on, which is every default
     * Windows clone. The comparison then failed on bytes git itself considers
     * identical, so a stale doc and a Windows checkout produced the same red
     * and only one of them meant anything — `npm run docs:modes` "fixed" the
     * second by rewriting the file to bytes git saw no change in.
     *
     * Stripping keeps the check about the table's CONTENT, which is the only
     * thing that command can actually fix.
     */
    const CR = String.fromCharCode(13);
    const lf = (text: string): string => text.split(CR).join('');

    function tableInDoc(): string {
        const doc = lf(readFileSync(DOC_PATH, 'utf8'));
        const start = doc.indexOf(START);
        const end = doc.indexOf(END);
        expect(start, `${START} marker missing from the doc`).toBeGreaterThanOrEqual(0);
        expect(end, `${END} marker missing from the doc`).toBeGreaterThan(start);
        return doc.slice(start + START.length, end).trim();
    }

    it('every capability on DeploymentProfile has a documented row', () => {
        // STANDALONE_PROFILE is a complete DeploymentProfile, so its keys ARE
        // the field set. Reading them off the value rather than the type is
        // deliberate: a type has no keys at runtime, and a spec that cannot see
        // a new field is exactly the failure this file exists to prevent.
        const fields = Object.keys(STANDALONE_PROFILE);
        const rendered = renderModesTable();
        const missing = fields.filter((f) => !rendered.includes(`| \`${f}\` |`));

        // Both numbers, always. A run that inspected nothing must not read as a
        // pass — if `fields` were ever empty, `missing` would be empty too.
        // eslint-disable-next-line no-console
        console.log(
            `[gate] deployment-modes doc — ${fields.length} capabilities on the profile, ${missing.length} undocumented`,
        );
        expect(fields.length, 'read no capabilities off STANDALONE_PROFILE — the import is broken').toBeGreaterThan(0);
        expect(
            missing,
            `capabilities with no row: ${missing.join(', ')} — add them to DESCRIPTIONS in scripts/gen-deployment-modes-doc.ts, then run \`npm run docs:modes\``,
        ).toEqual([]);
    });

    it('the checked-in table matches what the constants render', () => {
        expect(
            tableInDoc(),
            'docs/reference/deployment-modes.md is stale — run `npm run docs:modes`',
        ).toBe(lf(renderModesTable()));
    });
});
