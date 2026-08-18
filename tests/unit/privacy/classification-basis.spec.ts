/**
 * CA-10 and CA-11 — the two classifications that were absences, and the reason
 * each one has to travel with the classification rather than in a memory.
 *
 * Counsel round 27:
 *  - CA-10 (`inspections.address_lat` / `address_lng`): a typed address geocoded
 *    by a places API is NOT statutory precise geolocation, because
 *    §1798.140(w) requires data "derived from a device". Counsel's words:
 *    "this is a statutory exclusion, not merely an architectural accident", and
 *    "the reason is the statutory definition, not simply 'we don't currently use
 *    GPS'". The standing architecture rule that comes with it is a trip-wire:
 *    "Do not treat device-derived location as equivalent to address geocoding."
 *  - CA-11 (`inspection_messages.body`): the SPI exclusion in
 *    §1798.140(ae)(1)(E) turns on the business being the intended recipient, so
 *    the answer is directional. Counsel refused the one-word form
 *    (`inspection_messages = not SPI`) and prescribed the vocabulary recorded
 *    here: `conditional_by_direction`, reason `statutory intended-recipient
 *    test`.
 *
 * The point of the register these tests read is that a classification carries
 * WHY it holds, so that when the reason stops being true the classification
 * visibly stops with it. Two consequences are asserted below and are the reason
 * this file exists at all:
 *
 *  1. An entry nobody has actually judged must be DISTINGUISHABLE from one
 *     counsel ruled on, and the mix must be counted out loud. A census is
 *     checked in here; adding an entry without updating it fails, and the
 *     failure prints both numbers.
 *  2. Every invariant is paired with a fabricated positive control, because a
 *     validator that returns "no problems" for a malformed entry is exactly how
 *     an unreviewed classification comes to read as reviewed.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ERASURE_MANIFEST } from '../../../server/lib/compliance/erasure-manifest';
import { r2Keys } from '../../../server/lib/r2-keys';
import { ERASURE_OUT_OF_SCOPE } from '../../../server/lib/compliance/erasure-out-of-scope';
import {
    STATUTORY_CLASSIFICATIONS,
    type StatutoryClassification,
} from '../../../server/lib/compliance/statutory-classifications';

/** The plan's name for the register; the export is the precise one. */
const CLASSIFICATIONS = STATUTORY_CLASSIFICATIONS;

const BASIS_KINDS = ['statutory_exclusion', 'architecture_dependent', 'conditional'];
const REVIEW_STATES = ['counsel_ruled', 'engineering_provisional', 'not_assessed'];

/**
 * The census, checked in. It is not a style preference: `engineering_provisional`
 * and `not_assessed` are the states in which the register is NOT a legal
 * determination, and a register that grows one of them silently is the failure
 * the whole file is about. Moving these numbers is allowed and visible.
 */
const EXPECTED_CENSUS = { counsel_ruled: 3, engineering_provisional: 1, not_assessed: 0 };

/**
 * The columns whose consumer-erasure coverage is a recorded GAP rather than a
 * rule. Both are the columns this task brought into compliance at all, and
 * neither was made to look answered by filing it as out-of-scope: a message body
 * plainly can carry a data subject's own words, so "the heuristic never asked"
 * is the honest entry and "deliberately skipped" would have been a false one.
 */
const EXPECTED_GAPS = ['inspection_media_pool.exif_data', 'inspection_messages.body'];

const key = (e: { table: string; column: string }) => `${e.table}.${e.column}`;
const MANIFEST_KEYS = new Set(ERASURE_MANIFEST.map(key));
const OUT_OF_SCOPE_KEYS = new Set(ERASURE_OUT_OF_SCOPE.map(key));

/**
 * Every problem with one entry, as strings. A well-formed entry yields [].
 *
 * The rules that matter are the last four: an entry may not name a statute
 * without saying what kind of answer it is; a conditional answer must name the
 * axis it turns on in a machine-readable field rather than only in prose; a
 * ruling id is required when we say counsel ruled; and an unjudged entry may
 * carry NO statutory basis and NO basis kind, because a half-filled entry is the
 * one that reads as a decision.
 */
function problems(e: StatutoryClassification): string[] {
    const out: string[] = [];
    const id = `${e.table}.${e.column}`;
    for (const f of ['table', 'column', 'reason', 'erasure_coverage', 'reached_by'] as const) {
        if (!e[f] || e[f].trim() === '') out.push(`${id}: '${f}' is empty`);
    }
    if (!REVIEW_STATES.includes(e.review_status)) {
        out.push(`${id}: review_status '${e.review_status}' is not one of ${REVIEW_STATES.join(', ')}`);
    }
    if (e.statutory_basis && !e.basis_kind) {
        out.push(`${id}: names ${e.statutory_basis} but does not say whether that is an exclusion, an architecture-dependent answer, or conditional`);
    }
    if (e.basis_kind && !BASIS_KINDS.includes(e.basis_kind)) {
        out.push(`${id}: basis_kind '${e.basis_kind}' is not one of ${BASIS_KINDS.join(', ')}`);
    }
    if (e.basis_kind && !e.statutory_basis) {
        out.push(`${id}: basis_kind '${e.basis_kind}' names no statute, so it classifies nothing`);
    }
    if (e.basis_kind === 'conditional' && !e.spi_classification) {
        out.push(`${id}: a conditional answer must name its axis in a field, not only in prose`);
    }
    if (e.review_status === 'counsel_ruled' && !e.ruling) {
        out.push(`${id}: says counsel ruled but names no ruling`);
    }
    if (e.review_status !== 'counsel_ruled' && !e.open_question) {
        out.push(`${id}: is not a counsel ruling and states no open question, so nobody can tell it apart from one`);
    }
    if (e.review_status === 'not_assessed' && (e.statutory_basis || e.basis_kind)) {
        out.push(`${id}: is marked not_assessed yet carries a statutory classification`);
    }
    if (e.erasure_coverage !== 'gap' && !MANIFEST_KEYS.has(e.erasure_coverage)) {
        out.push(`${id}: erasure_coverage '${e.erasure_coverage}' names no rule in ERASURE_MANIFEST`);
    }
    return out;
}

/** A well-formed entry, used as the base for the fabricated controls. */
const fixture = (over: Partial<StatutoryClassification> = {}): StatutoryClassification => ({
    table: 'fixture_table',
    column: 'fixture_column',
    reason: 'a fabricated entry that exists only to prove the validator can fail',
    review_status: 'counsel_ruled',
    ruling: 'CA-00',
    erasure_coverage: 'gap',
    reached_by: 'nothing — this row is not real',
    ...over,
});

describe('the register itself', () => {
    it('is not empty, which is the positive control for every check below', () => {
        // A "no malformed entries" assertion over an empty array is green.
        expect(CLASSIFICATIONS.length).toBeGreaterThanOrEqual(4);
    });

    it('every tracked entry is well-formed', () => {
        const found = CLASSIFICATIONS.flatMap(problems);
        expect(found, `${CLASSIFICATIONS.length} entries checked; ${found.length} problem(s)`).toEqual([]);
    });

    it('and the validator that said so can actually fail', () => {
        // Four fabricated controls, one per rule that carries the weight.
        expect(problems(fixture({ statutory_basis: 'Cal. Civ. Code §1798.140(w)' })))
            .toHaveLength(1);
        expect(problems(fixture({ basis_kind: 'statutory_exclusion' })))
            .toHaveLength(1);
        expect(problems(fixture({
            statutory_basis: 'Cal. Civ. Code §1798.140(ae)(1)(E)', basis_kind: 'conditional',
        }))).toHaveLength(1);
        expect(problems(fixture({
            review_status: 'not_assessed',
            open_question: 'who answers this',
            statutory_basis: 'Cal. Civ. Code §1798.140(w)',
            basis_kind: 'architecture_dependent',
        }))).toHaveLength(1);
    });
});

describe('an unjudged classification cannot look judged', () => {
    it('the census is checked in, and prints both numbers either way', () => {
        const census = { counsel_ruled: 0, engineering_provisional: 0, not_assessed: 0 };
        for (const e of CLASSIFICATIONS) census[e.review_status] += 1;
        console.info(
            `[classification-basis] ${CLASSIFICATIONS.length} entries: ` +
            `counsel_ruled=${census.counsel_ruled}, ` +
            `engineering_provisional=${census.engineering_provisional}, ` +
            `not_assessed=${census.not_assessed}`,
        );
        expect(census, `census over ${CLASSIFICATIONS.length} entries`).toEqual(EXPECTED_CENSUS);
        // A census that does not sum to the register has stopped counting some of
        // it, which is the same blindness in a different place.
        const summed = Object.values(census).reduce((a, b) => a + b, 0);
        expect(summed, 'census total vs register length').toBe(CLASSIFICATIONS.length);
    });

    it('names every entry counsel has not ruled on, rather than counting them', () => {
        const open = CLASSIFICATIONS
            .filter((e) => e.review_status !== 'counsel_ruled')
            .map((e) => `${key(e)} (${e.review_status}) — ${e.open_question ?? 'NO OPEN QUESTION'}`);
        console.info(`[classification-basis] not counsel-ruled: ${open.join(' | ') || '(none)'}`);
        expect(open).toHaveLength(
            EXPECTED_CENSUS.engineering_provisional + EXPECTED_CENSUS.not_assessed,
        );
    });
});

describe('every classification that names a statute says what kind of answer it is', () => {
    it('holds for the whole register', () => {
        for (const e of CLASSIFICATIONS) {
            if (!e.statutory_basis) continue;
            expect(BASIS_KINDS, key(e)).toContain(e.basis_kind);
        }
    });

    it('and at least one entry names a statute, so the loop is not vacuous', () => {
        expect(CLASSIFICATIONS.filter((e) => e.statutory_basis).length).toBeGreaterThan(0);
    });
});

describe('CA-10 — the address geocode', () => {
    const family = ['address_lat', 'address_lng'];

    it('classifies BOTH coordinate columns, not one of the pair', () => {
        const found = CLASSIFICATIONS
            .filter((e) => e.table === 'inspections' && family.includes(e.column))
            .map((e) => e.column);
        expect(found.sort()).toEqual(family);
    });

    it('records a statutory exclusion, and the statute it comes from', () => {
        for (const column of family) {
            const e = CLASSIFICATIONS.find((c) => c.column === column);
            expect(e?.basis_kind, column).toBe('statutory_exclusion');
            expect(e?.statutory_basis, column).toMatch(/1798\.140\(w\)/);
            expect(e?.reason, column).toMatch(/derived from a device/i);
            expect(e?.ruling, column).toBe('CA-10');
        }
    });

    it('records the device-derived trip-wire beside it', () => {
        for (const column of family) {
            const e = CLASSIFICATIONS.find((c) => c.column === column);
            expect(e?.tripwire, column).toMatch(/device/i);
        }
    });

    it('points at the erasure rule that already governs the column', () => {
        // The rules pre-date this register; CA-10 adds the statutory reading, not
        // the rule. An entry that pointed at nothing would be a second, drifting
        // record of the same column.
        for (const column of family) {
            const e = CLASSIFICATIONS.find((c) => c.column === column);
            expect(e?.erasure_coverage, column).toBe(`inspections.${column}`);
            expect(MANIFEST_KEYS.has(`inspections.${column}`), `manifest rule for ${column}`).toBe(true);
        }
    });
});

describe('CA-11 — message bodies are classified by direction, not by one verdict', () => {
    const entry = () => CLASSIFICATIONS.find((c) => c.table === 'inspection_messages');

    it('carries the conditional vocabulary counsel prescribed', () => {
        expect(entry()?.spi_classification).toBe('conditional_by_direction');
        expect(entry()?.reason).toMatch(/intended.recipient/i);
        expect(entry()?.statutory_basis).toMatch(/1798\.140\(ae\)\(1\)\(E\)/);
        expect(entry()?.ruling).toBe('CA-11');
    });

    it('does NOT assert the exclusion outright, which is the one-word answer counsel refused', () => {
        expect(entry()?.basis_kind).toBe('conditional');
        expect(entry()?.basis_kind).not.toBe('statutory_exclusion');
    });

    it('names both directions, so the asymmetry survives without the ruling beside it', () => {
        const text = `${entry()?.reason ?? ''} ${entry()?.tripwire ?? ''}`;
        expect(text).toMatch(/inspector/i);
        expect(text).toMatch(/(homebuyer|client|consumer)/i);
    });
});

describe('inspection_media_pool.exif_data — the counter-case', () => {
    const entry = () => CLASSIFICATIONS.find((c) => c.column === 'exif_data');

    it('is present at all', () => {
        expect(CLASSIFICATIONS.some((c) => c.column === 'exif_data')).toBe(true);
    });

    it('is architecture-dependent, NOT a statutory exclusion', () => {
        // This is the whole force of CA-10: device-derived location is a
        // different fact pattern, so the safe answer here is bought by code that
        // can change, not by the statute. Recording it as an exclusion would
        // borrow the address family's protection for a column that has none.
        expect(entry()?.basis_kind).toBe('architecture_dependent');
        expect(entry()?.review_status).toBe('engineering_provisional');
        expect(entry()?.open_question, 'the question counsel has not been asked').toBeTruthy();
    });

    it('says which code fact it depends on', () => {
        expect(`${entry()?.reason ?? ''} ${entry()?.tripwire ?? ''}`).toMatch(/gps/i);
    });

    it('and that code fact is true today, read from the writer rather than asserted', () => {
        // The manifest's own warning: a compliance classification resting on a
        // comment is a classification resting on nothing. So this reads the one
        // writer of the column.
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../../server/services/inspection/inspection-photo.service.ts'),
            'utf8',
        );
        const writes = [...src.matchAll(/const exifData\s*=\s*([^;]+);/g)].map((m) => m[1]);
        // Positive control: if the assignment moved or was renamed, this check
        // stops proving anything and must fail rather than pass empty.
        expect(writes, 'no exifData assignment found — the check below would be vacuous').toHaveLength(1);
        expect(writes[0]).toMatch(/takenAt/);
        expect(writes[0], 'a writer now persists device GPS — re-run the CA-10 classification').not.toMatch(/gps/i);
    });
});

describe('the store registry names what these classifications found', () => {
    // Both columns sit inside stores the registry ALREADY listed (D1 `DB`, and
    // R2 `PHOTOS` for the attachments), so neither becomes a store entry of its
    // own — the unit of account there is a reachable binding, and rows for
    // tables would inflate every count on that page. What the registry gains is
    // the data category, so a reader coming from the store side finds them.
    const registry = fs.readFileSync(
        path.resolve(__dirname, '../../../compliance/processing-stores.jsonc'),
        'utf8',
    );

    it('reads the registry it is asserting on', () => {
        // Positive control: the three assertions below are substring checks, and
        // a mistyped path would satisfy none of them for the wrong reason.
        expect(registry).toMatch(/"binding":\s*"PHOTOS"/);
        expect(registry).toMatch(/"binding":\s*"DB"/);
    });

    it('carries a category for each family the classifications named', () => {
        for (const category of ['message_thread', 'media_metadata', 'message_attachment']) {
            expect(registry, category).toContain(`"${category}"`);
        }
    });

    it('and the attachment prefix the registry claims is the one the key builder writes', () => {
        // The registry says attachments are swept by the bare `{tenantId}/`
        // prefix pass because their keys live under it. That is a code fact, so
        // it is read rather than asserted.
        expect(r2Keys.messageAttachment('tenant-1', 'msg-1', 'att-1', 'pdf'))
            .toBe('tenant-1/messages/msg-1/att-1.pdf');
    });
});

describe('the two absences are recorded as gaps, not laundered into decisions', () => {
    it('the gap set is exactly the one checked in here', () => {
        const gaps = CLASSIFICATIONS.filter((e) => e.erasure_coverage === 'gap').map(key).sort();
        expect(gaps, `${CLASSIFICATIONS.length} entries scanned`).toEqual(EXPECTED_GAPS);
    });

    it('and each gap is a real absence in both erasure arrays, not a claim', () => {
        for (const k of EXPECTED_GAPS) {
            expect(MANIFEST_KEYS.has(k), `${k} has a manifest rule after all`).toBe(false);
            expect(OUT_OF_SCOPE_KEYS.has(k), `${k} is declared out of scope after all`).toBe(false);
        }
        // Positive control for the two negatives above: the sets are populated.
        expect(MANIFEST_KEYS.size).toBeGreaterThan(20);
        expect(OUT_OF_SCOPE_KEYS.size).toBeGreaterThan(20);
    });

    it('every gap still says what DOES reach the column, so a gap is not read as "never deleted"', () => {
        for (const e of CLASSIFICATIONS.filter((c) => c.erasure_coverage === 'gap')) {
            expect(e.reached_by, key(e)).toMatch(/purge|cascade/i);
        }
    });
});
