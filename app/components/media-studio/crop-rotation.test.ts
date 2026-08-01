/**
 * The geometry the rotated bake depends on.
 *
 * react-easy-crop reports the crop rect in the space of the ROTATED image, so
 * the bake has to rebuild that exact space before it can index into it. Get the
 * bounding box wrong and nothing throws — you get a crop of the wrong region,
 * which is the failure where someone straightens a photographed signature and
 * saves a corner of the paper it was written on.
 */
import { describe, it, expect } from 'vitest';
import { normalizeRotation, rotatedBounds } from '~/components/media-studio/cropImage';

describe('normalizeRotation', () => {
  it('folds a left turn past zero into the equivalent positive angle', () => {
    // What "rotate left" produces on the first click. -90 into a raw
    // `ctx.rotate` works, but it leaks a negative into the bounds maths and
    // into any comparison against 0.
    expect(normalizeRotation(-90)).toBe(270);
  });
  it('folds a full turn back to none', () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(-360)).toBe(0);
  });
  it('leaves the quarter turns alone', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
  });
});

describe('rotatedBounds', () => {
  it('returns the source dimensions unchanged at zero', () => {
    // This is the path every inspection-editor photo crop takes. If it ever
    // stopped being an identity, every existing crop would shift.
    expect(rotatedBounds(1600, 1200, 0)).toEqual({ width: 1600, height: 1200 });
  });

  it('swaps width and height on a quarter turn', () => {
    expect(rotatedBounds(1600, 1200, 90)).toEqual({ width: 1200, height: 1600 });
    expect(rotatedBounds(1600, 1200, 270)).toEqual({ width: 1200, height: 1600 });
  });

  it('returns the source dimensions on a half turn', () => {
    expect(rotatedBounds(1600, 1200, 180)).toEqual({ width: 1600, height: 1200 });
  });

  it('grows the box on an off-axis angle, never shrinks it', () => {
    // Not reachable from the two buttons, but the maths must hold if a finer
    // control is ever added — a box smaller than the source would clip.
    const b = rotatedBounds(1000, 1000, 45);
    expect(b.width).toBeGreaterThan(1000);
    expect(b.height).toBeGreaterThan(1000);
    expect(b.width).toBe(Math.round(1000 * Math.SQRT2));
  });
});
