/**
 * Choosing an appearance profile for a migrated workspace, with no model
 * involved at any point.
 *
 * The report style this product offers is a CLOSED SET — three built-in
 * profiles and a primary colour — so picking one is arithmetic over a brand
 * colour, and finding the brand colour is arithmetic over pixels. There is
 * nothing here for a model to add, and every assertion below is exact for that
 * reason: a wrong answer is a bug, not a matter of taste.
 *
 * Every "this colour maps here" case is paired with one that maps elsewhere.
 * A mapper that returned a constant would satisfy any single case, and it would
 * give every migrated workspace the same report.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_PROFILES } from '../../../server/lib/report-style/profiles';
import { dominantBrandColour, nearestProfile } from '../../../server/lib/report-style/infer-profile';

/** RGBA bytes, the shape a decoded image arrives in. */
function pixels(...colours: [number, number, number, number][]): Uint8ClampedArray {
    return Uint8ClampedArray.from(colours.flat());
}

function repeat(colour: [number, number, number, number], times: number): [number, number, number, number][] {
    return Array.from({ length: times }, () => colour);
}

const GREY: [number, number, number, number] = [136, 136, 136, 255];
const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const NAVY: [number, number, number, number] = [11, 61, 107, 255];
const RUST: [number, number, number, number] = [138, 75, 42, 255];

describe('nearestProfile', () => {
    it('picks the nearest built-in profile for a colour', () => {
        expect(nearestProfile('#0b3d6b')).toBe('meridian');
    });

    it('POSITIVE CONTROL — a different colour picks a different profile', () => {
        // Otherwise the assertion above passes for a function returning a
        // constant, which would give every migrated workspace the same look.
        expect(nearestProfile('#8a4b2a')).not.toBe(nearestProfile('#0b3d6b'));
        expect(nearestProfile('#8a4b2a')).toBe('terra');
    });

    it('falls back to the neutral profile for a colour that is neither', () => {
        expect(nearestProfile('#7a7a7a')).toBe('signature');
    });

    it('falls back to the neutral profile rather than throwing on a colour it cannot read', () => {
        expect(nearestProfile('not a colour')).toBe('signature');
        expect(nearestProfile('')).toBe('signature');
    });

    it('only ever names a profile that exists', () => {
        // A profile id that resolves to nothing does not fail — the resolver
        // silently falls back — so a typo here would ship as "every migrated
        // workspace got the default" with nothing red anywhere.
        for (const colour of ['#0b3d6b', '#8a4b2a', '#7a7a7a', '#00ff00', 'nonsense']) {
            expect(Object.keys(BUILTIN_PROFILES)).toContain(nearestProfile(colour));
        }
    });
});

describe('dominantBrandColour', () => {
    it('ignores near-neutral colours rather than treating grey as a brand', () => {
        expect(dominantBrandColour(pixels(...repeat(GREY, 40)))).toBeNull();
    });

    it('POSITIVE CONTROL — the same image with a coloured mark finds it', () => {
        // Without this, the refusal above passes for a function that always
        // returns null, and no logo would ever set a workspace's colour.
        const found = dominantBrandColour(pixels(...repeat(GREY, 40), ...repeat(NAVY, 12)));
        expect(found).toMatch(/^#[0-9a-f]{6}$/);
        expect(nearestProfile(found!)).toBe('meridian');
    });

    it('does not let a white background outvote the mark on it', () => {
        // A logo is mostly its background. Counting the background would make
        // every brand colour white, which is then discarded as neutral — and
        // the feature would look like it simply never works.
        const found = dominantBrandColour(pixels(...repeat(WHITE, 900), ...repeat(RUST, 30)));
        expect(nearestProfile(found!)).toBe('terra');
    });

    it('returns null for a fully transparent image', () => {
        expect(dominantBrandColour(pixels(...repeat([11, 61, 107, 0], 40)))).toBeNull();
    });

    it('returns null when too few coloured pixels back the answer', () => {
        // Two stray anti-aliased pixels in a grey logo are not a brand colour.
        // Answering from them would be a confident wrong answer, which is the
        // one outcome worse than none.
        expect(dominantBrandColour(pixels(...repeat(GREY, 4000), ...repeat(NAVY, 2)))).toBeNull();
    });

    it('returns null for an empty image', () => {
        expect(dominantBrandColour(new Uint8ClampedArray(0))).toBeNull();
    });

    it('picks the more numerous of two brand colours', () => {
        // POSITIVE CONTROL for the counting itself: a function that returned
        // the first coloured pixel it saw would pass every case above.
        const found = dominantBrandColour(pixels(...repeat(NAVY, 10), ...repeat(RUST, 60)));
        expect(nearestProfile(found!)).toBe('terra');
    });
});
