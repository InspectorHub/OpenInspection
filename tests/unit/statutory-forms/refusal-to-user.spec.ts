import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { refusalToUser } from '../../../server/lib/statutory/refusal-to-user';
import { AppError } from '../../../server/lib/errors';

/**
 * Every refusal this subsystem writes reaches the person holding the form.
 *
 * ── WHY THE LIST IS DERIVED AND NOT RESTATED ────────────────────────────────
 * The defect this guards is a MISSING entry, and a test that names the prefixes
 * it expects would be written from the same list that is missing one. So the
 * prefixes are read out of the subsystem's own sources: every
 * `statutory <stage>: ` a module throws with has to be one `refusalToUser`
 * translates, or the sentence behind it arrives as `{"error":{"message":
 * "Internal server error"}}`.
 *
 * Measured 2026-08-30 by producing FL OIR-B1-1802 with an answer to a question
 * that form does not ask: three of the six prefixes were missing, and the reader
 * got a 500 on a request that had been refused for a reason they could act on.
 *
 * Two are excluded BY NAME, so the exclusion is a decision a reader can argue
 * with rather than a scan that happened not to reach them. Both reasons are on
 * `REFUSAL_PREFIXES` itself: `statutory binding policy:` is thrown while a
 * template is installed, and `statutory field map:` says the published map is
 * broken for every inspection equally — neither is a fact about the inspection
 * in front of the reader.
 */
const PRODUCE_PATH_DIRS = [
    'server/lib/statutory',
    'server/services/statutory',
];
const NOT_A_FACT_ABOUT_THIS_INSPECTION = new Set([
    'statutory binding policy: ',
    'statutory field map: ',
]);

function prefixesThrownBy(dir: string): Set<string> {
    const found = new Set<string>();
    const root = join(process.cwd(), dir);
    for (const name of readdirSync(root)) {
        if (!name.endsWith('.ts')) continue;
        const text = readFileSync(join(root, name), 'utf8');
        // Only where a message is BUILT: a template literal or a quoted string
        // opening with the prefix. Prose in a comment names stages too.
        for (const m of text.matchAll(/[`'"](statutory [a-z ]+?: )/g)) found.add(m[1]);
    }
    return found;
}

describe('statutory refusals reaching the reader', () => {
    it('translates every prefix the produce path throws with', async () => {
        const thrown = new Set<string>();
        for (const dir of PRODUCE_PATH_DIRS) {
            for (const p of prefixesThrownBy(dir)) {
                if (!NOT_A_FACT_ABOUT_THIS_INSPECTION.has(p)) thrown.add(p);
            }
        }
        // A zero-hit scan would pass every assertion below vacuously — this is
        // the number that says the instrument found the sources at all.
        expect(thrown.size).toBeGreaterThanOrEqual(6);

        const untranslated: string[] = [];
        for (const prefix of thrown) {
            try {
                await refusalToUser(async () => { throw new Error(`${prefix}the reason`); });
                untranslated.push(`${prefix}(did not throw)`);
            } catch (e) {
                if (!(e instanceof AppError) || e.status !== 422) untranslated.push(prefix);
            }
        }
        expect(untranslated, `${thrown.size} prefixes scanned`).toEqual([]);
    });

    it('drops the stage prefix and keeps the sentence', async () => {
        await expect(refusalToUser(async () => {
            throw new Error('statutory values: "roof_wall_attachment_minimal_condition" is answered "2"');
        })).rejects.toThrow(/cannot be produced yet\. "roof_wall_attachment_minimal_condition"/);
        await expect(refusalToUser(async () => {
            throw new Error('statutory values: x');
        })).rejects.toThrow(/^(?!.*statutory values:).*$/s);
    });

    it('NEGATIVE CONTROL — a failure that is NOT a refusal stays a failure', async () => {
        // Dressing an unexpected error up as something the reader can act on
        // would be a lie with a status code on it.
        await expect(refusalToUser(async () => { throw new Error('boom'); }))
            .rejects.toThrow('boom');
        await expect(refusalToUser(async () => {
            throw new Error('statutory binding policy: "owner_name" names a person');
        })).rejects.toThrow(/binding policy/);
        await expect(refusalToUser(async () => {
            throw new Error('statutory field map: two mappings draw the same box');
        })).rejects.toThrow(/^statutory field map: /);
    });
});
