import { describe, it, expect } from 'vitest';
import { PatchProfileSchema } from '../../../server/api/profile';
import { FL_1802_QUALIFICATION_CATEGORIES } from '../../../server/lib/statutory/qualification-categories';
import { fieldMap } from '../../../server/lib/statutory/forms/fl-oir-b1-1802';

/**
 * The write path for `statutory_qualification`, closed to the form's own list.
 *
 * The profile screen has offered nothing but these six categories and an
 * explicit "none" since the free-text input was retired, but the API accepted
 * `z.string().max(120)` — any sentence at all. The only way to store an unusable
 * value was a hand-written PATCH, and the refusal then arrived at RENDER time:
 * after the fieldwork, on the day the inspector tried to produce the document,
 * from a subsystem the inspector was not interacting with when the mistake was
 * made. Moving the refusal to the write is the whole point.
 *
 * ⚠️ ASSERTED AGAINST THE PUBLISHED MAP, NOT AGAINST A LIST TYPED HERE. A
 * literal copied out of `qualification-categories.ts` in the same change as the
 * schema would agree with the schema and with nothing else — the failure this
 * subsystem exists to prevent is a stored value no mapping can tick, so the
 * check has to reach the mapping.
 */

const field = 'statutoryQualification';

/** Every value the 1802's field map will actually tick a box for. */
const tickable = new Set(
    fieldMap.mappings
        .filter((m) => m.ourField === 'inspector_qualification' && 'whenValue' in m)
        .map((m) => (m as { whenValue: string }).whenValue),
);

describe('statutory_qualification — the write path refuses what the form cannot print', () => {
    it('CONTROL — the published map really does tick boxes for this field', () => {
        // Without this the two assertions below are satisfied by an empty set:
        // a mapping renamed out from under them would make every category
        // "unmatched" and the suite would still be green in the other direction.
        expect(tickable.size).toBeGreaterThan(0);
    });

    it('accepts every category the form prints, and each one is tickable', () => {
        for (const category of FL_1802_QUALIFICATION_CATEGORIES) {
            const parsed = PatchProfileSchema.safeParse({ [field]: category.value });
            expect(parsed.success, category.value).toBe(true);
            expect(tickable, category.value).toContain(category.value);
        }
    });

    it('accepts the empty string, because declaring nothing is a real answer', () => {
        // Only one of the four published forms asks, so most inspectors never
        // fill this in. Refusing "" would make a wrong category permanent.
        expect(PatchProfileSchema.safeParse({ [field]: '' }).success).toBe(true);
    });

    it('refuses a value no mapping can tick', () => {
        for (const bad of ['Building code inspector', 'home inspector', 'HOME_INSPECTOR', 'plumber']) {
            const parsed = PatchProfileSchema.safeParse({ [field]: bad });
            expect(parsed.success, bad).toBe(false);
            expect(tickable, bad).not.toContain(bad);
        }
    });

    it('NEGATIVE CONTROL — the licence TYPE beside it stays open, and deliberately', () => {
        // A licence class is a state's own vocabulary; an enum there would be
        // this software deciding what a state licenses. The two fields look
        // alike and are not, so a change that closed both would pass every
        // assertion above while being wrong.
        const parsed = PatchProfileSchema.safeParse({
            statutoryLicenseType: 'Registered Professional Inspector',
        });
        expect(parsed.success).toBe(true);
    });
});
