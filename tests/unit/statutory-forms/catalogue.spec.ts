/**
 * The catalogue is consistent with itself, and its emptiness is declared.
 *
 * ⚠️ EVERY ASSERTION BELOW THAT LOOPS OVER THE CATALOGUE IS VACUOUS WHILE IT IS
 * EMPTY, which is the state it is in today. A suite of loops over an empty list
 * is a green run that checked nothing, so the census is asserted OUT LOUD: the
 * number of forms this software publishes is itself a fact under test, and the
 * day it changes these tests start doing work instead of quietly continuing to
 * pass.
 */
import { describe, it, expect } from 'vitest';
import {
    EMPTY_CATALOGUE_REASON,
    FIELD_MAPS,
    PUBLISHED_FORM_VERSIONS,
    fieldMapFor,
} from '../../../server/lib/statutory/forms';
import { validateFieldMap } from '../../../server/lib/statutory/field-map';

describe('the statutory form catalogue', () => {
    it('declares WHY it is empty, whenever it is empty', () => {
        // The two states this pins together: a list with nothing in it must
        // carry a reason, and a reason must not outlive the emptiness it
        // explains. Either half alone lets "no statutory forms" become
        // unverifiable — the first because silence reads as a failed load, the
        // second because a stale explanation reads as the current state.
        if (PUBLISHED_FORM_VERSIONS.length === 0) {
            expect(EMPTY_CATALOGUE_REASON, 'an empty catalogue must say why').not.toBeNull();
            expect((EMPTY_CATALOGUE_REASON ?? '').length).toBeGreaterThan(40);
        } else {
            expect(EMPTY_CATALOGUE_REASON, 'a non-empty catalogue must drop the reason').toBeNull();
        }
    });

    it('publishes the number of forms it claims to — today, none', () => {
        // The census, stated rather than looped over. When this fails because a
        // form was published, update the number and read every test below as
        // newly load-bearing.
        expect(PUBLISHED_FORM_VERSIONS).toHaveLength(0);
        expect(FIELD_MAPS).toHaveLength(0);
    });

    it('pairs every revision with exactly one field map, both ways', () => {
        const versionKeys = PUBLISHED_FORM_VERSIONS.map((v) => `${v.formId} ${v.version}`).sort();
        const mapKeys = FIELD_MAPS.map((m) => `${m.formId} ${m.version}`).sort();
        expect(mapKeys).toEqual(versionKeys);
        // A revision that appears twice would give `fieldMapFor` two answers and
        // no way to choose.
        expect(new Set(versionKeys).size).toBe(versionKeys.length);
    });

    it('every published map validates against its own revision', () => {
        let checked = 0;
        for (const version of PUBLISHED_FORM_VERSIONS) {
            const map = FIELD_MAPS.find(
                (m) => m.formId === version.formId && m.version === version.version,
            );
            expect(map, `${version.formId} ${version.version} has no field map`).toBeDefined();
            if (map !== undefined) {
                expect(() => validateFieldMap(map, version)).not.toThrow();
                checked += 1;
            }
        }
        // The loop above proves nothing on its own while the list is empty. This
        // line says how much it actually did.
        expect(checked).toBe(PUBLISHED_FORM_VERSIONS.length);
    });

    it('returns null for a form nothing publishes, rather than the nearest thing', () => {
        expect(fieldMapFor('xx_not_published', '1-0')).toBeNull();
    });
});
