/**
 * Where a signature lands inside the box somebody measured, and when it is too
 * coarse to put on an authority's form.
 *
 * The stretch these assertions exist to stop is invisible from the inside.
 * `drawImage` given both a width and a height honours both, so a mark drawn into
 * a box of a different proportion comes out squashed or smeared — and the
 * document still prints, still carries the right name beside it, and still
 * passes every assertion about its own values. So each placement test states the
 * SOURCE aspect ratio and the DRAWN one and requires them equal, rather than
 * checking the numbers landed somewhere plausible.
 */
import { describe, it, expect } from 'vitest';
import {
    placeSignature,
    refuseUnreadableSignature,
    MIN_SIGNATURE_PIXELS_PER_POINT,
    SUPPORTED_SIGNATURE_IMAGE_TYPES,
} from '../../../server/lib/statutory/signature-image';

/** A signature box off a real map: 160pt wide, 40pt tall, at 4:1. */
const BOX = { x: 72, y: 120, width: 160, height: 40 };

/** What this product's own signature pad produces. `SignaturePad` is 400x150. */
const OUR_OWN_PAD = { width: 400, height: 150 };

describe('placeSignature', () => {
    it('fits an image WIDER than the box to its width and centres it vertically', () => {
        // 8:1 into a 4:1 box. Width is the binding constraint.
        const placed = placeSignature({ width: 800, height: 100 }, BOX);
        expect(placed.width).toBeCloseTo(160, 6);
        expect(placed.height).toBeCloseTo(20, 6);
        // Flush left/right, and the 20pt of slack split evenly above and below.
        expect(placed.x).toBeCloseTo(72, 6);
        expect(placed.y).toBeCloseTo(130, 6);
        // The whole point: the drawn shape is the source shape.
        expect(placed.width / placed.height).toBeCloseTo(800 / 100, 6);
    });

    it('fits an image TALLER than the box to its height and centres it horizontally', () => {
        // 1:8 into a 4:1 box. Height is the binding constraint.
        const placed = placeSignature({ width: 100, height: 800 }, BOX);
        expect(placed.width).toBeCloseTo(5, 6);
        expect(placed.height).toBeCloseTo(40, 6);
        expect(placed.x).toBeCloseTo(149.5, 6);
        expect(placed.y).toBeCloseTo(120, 6);
        expect(placed.width / placed.height).toBeCloseTo(100 / 800, 6);
    });

    it('never draws outside the box it was given', () => {
        for (const pixels of [{ width: 800, height: 100 }, { width: 100, height: 800 }, OUR_OWN_PAD]) {
            const placed = placeSignature(pixels, BOX);
            expect(placed.x).toBeGreaterThanOrEqual(BOX.x);
            expect(placed.y).toBeGreaterThanOrEqual(BOX.y);
            expect(placed.x + placed.width).toBeLessThanOrEqual(BOX.x + BOX.width + 1e-9);
            expect(placed.y + placed.height).toBeLessThanOrEqual(BOX.y + BOX.height + 1e-9);
        }
    });

    it('fills the box exactly when the proportions already agree', () => {
        const placed = placeSignature({ width: 1600, height: 400 }, BOX);
        expect(placed.x).toBeCloseTo(72, 6);
        expect(placed.y).toBeCloseTo(120, 6);
        expect(placed.width).toBeCloseTo(160, 6);
        expect(placed.height).toBeCloseTo(40, 6);
    });

    it('refuses a source with no area rather than dividing by it', () => {
        expect(() => placeSignature({ width: 0, height: 100 }, BOX)).toThrow(/pixel/i);
        expect(() => placeSignature({ width: 100, height: 0 }, BOX)).toThrow(/pixel/i);
    });

    it('refuses a box with no area', () => {
        expect(() => placeSignature(OUR_OWN_PAD, { ...BOX, width: 0 })).toThrow(/box/i);
    });
});

describe('the resolution verdict', () => {
    it('calls a mark too coarse when it falls below the stated floor', () => {
        // 120x40 into a 4:1 box is height-bound, so it is drawn at 1:1 with the
        // point grid -- 72 DPI, screen resolution, on paper.
        const placed = placeSignature({ width: 120, height: 40 }, BOX);
        expect(placed.pixelsPerPoint).toBeCloseTo(1, 6);
        expect(placed.dpi).toBeCloseTo(72, 6);
        expect(placed.tooSmall).toBe(true);
    });

    it('does NOT refuse what this product itself produces', () => {
        // The positive control, and the reason the floor is where it is. A gate
        // that refuses the only mark most inspectors will ever have is a gate
        // somebody routes around. The pad is 400x150; into this box that is
        // 3.75 px/pt, comfortably clear of the floor.
        const placed = placeSignature(OUR_OWN_PAD, BOX);
        expect(placed.pixelsPerPoint).toBeCloseTo(3.75, 6);
        expect(placed.tooSmall).toBe(false);
        expect(placed.pixelsPerPoint).toBeGreaterThan(MIN_SIGNATURE_PIXELS_PER_POINT);
    });

    it('states the floor as a multiple of the point grid, not as a pixel count', () => {
        // A pixel count would be wrong for every box but the one it was chosen
        // against. The floor is a ratio for the same reason a font floor is.
        expect(MIN_SIGNATURE_PIXELS_PER_POINT).toBe(2);
    });
});

describe('refuseUnreadableSignature', () => {
    it('names both numbers and where to go next', () => {
        const placed = placeSignature({ width: 120, height: 40 }, BOX);
        expect(() => refuseUnreadableSignature(placed, 'inspector_signature')).toThrow(
            'statutory render: "inspector_signature" would be drawn at 72 DPI, and this form '
            + 'needs at least 144 DPI. Draw the signature again, or upload a larger scan of it, '
            + 'under Settings > Profile.',
        );
    });

    it('lets an adequate signature through', () => {
        // Without this, a function that threw unconditionally would pass the
        // test above and prove nothing.
        const placed = placeSignature(OUR_OWN_PAD, BOX);
        expect(() => refuseUnreadableSignature(placed, 'inspector_signature')).not.toThrow();
    });
});

describe('SUPPORTED_SIGNATURE_IMAGE_TYPES', () => {
    it('is what pdf-lib can embed, and nothing else', () => {
        // pdf-lib embeds PNG and JPEG. There is no third one, and in particular
        // no vector one -- an SVG that passes a data-URI check is a signature
        // that cannot be drawn at the moment somebody presses send.
        expect([...SUPPORTED_SIGNATURE_IMAGE_TYPES]).toEqual(['png', 'jpeg']);
    });
});
