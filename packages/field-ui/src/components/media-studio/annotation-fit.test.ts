/**
 * `nextAnnotationRatio` decides how much smaller to export an over-limit annotated image: a bounded number of steps,
 * aspect ratio untouched (one ratio for both edges), never below a minimum edge, and nothing at all when it already fits.
 */
import { describe, expect, it } from 'vitest';
import { ANNOTATION_MAX_STEPS, ANNOTATION_MIN_EDGE, exportFittingAnnotation, nextAnnotationRatio } from './annotation-fit';

const LIMIT = 10 * 1024 * 1024;
const base = { width: 4000, height: 3000, limit: LIMIT };

describe('nextAnnotationRatio', () => {
  it('asks for nothing when the image already fits', () => {
    expect(nextAnnotationRatio({ ...base, ratio: 1, bytes: LIMIT, step: 0 })).toBeNull();
  });

  it('shrinks an over-limit image, by roughly the square root of how far over it is', () => {
    const next = nextAnnotationRatio({ ...base, ratio: 1, bytes: LIMIT * 2, step: 0 });
    expect(next).not.toBeNull();
    expect(next as number).toBeLessThan(0.9);
    expect(next as number).toBeGreaterThan(0.5);
  });

  it('never shrinks by less than a tenth or by more than a half in one step', () => {
    expect(nextAnnotationRatio({ ...base, ratio: 1, bytes: LIMIT + 1, step: 0 })).toBeCloseTo(0.9, 5);
    expect(nextAnnotationRatio({ ...base, ratio: 1, bytes: LIMIT * 100, step: 0 })).toBeCloseTo(0.5, 5);
  });

  it('compounds on the ratio already tried', () => {
    expect(nextAnnotationRatio({ ...base, ratio: 0.5, bytes: LIMIT * 100, step: 1 })).toBeCloseTo(0.25, 5);
  });

  it('stops after the bounded number of steps', () => {
    expect(nextAnnotationRatio({ ...base, ratio: 1, bytes: LIMIT * 2, step: ANNOTATION_MAX_STEPS })).toBeNull();
    expect(nextAnnotationRatio({ ...base, ratio: 1, bytes: LIMIT * 2, step: ANNOTATION_MAX_STEPS - 1 })).not.toBeNull();
  });

  it('never goes below the minimum edge: it lands on it once, then gives up', () => {
    const small = { width: 800, height: 700, limit: LIMIT };
    const floor = ANNOTATION_MIN_EDGE / 700;
    expect(nextAnnotationRatio({ ...small, ratio: 1, bytes: LIMIT * 100, step: 0 })).toBeCloseTo(floor, 5);
    expect(nextAnnotationRatio({ ...small, ratio: floor, bytes: LIMIT * 100, step: 1 })).toBeNull();
  });

  it('gives up on an image that is already smaller than the minimum edge', () => {
    expect(nextAnnotationRatio({ width: 500, height: 400, limit: LIMIT, ratio: 1, bytes: LIMIT * 2, step: 0 })).toBeNull();
  });
});

describe('exportFittingAnnotation', () => {
  /** A fake renderer whose output size follows the area, recording every ratio it was asked for. */
  const fakeRender = (fullBytes: number) => {
    const ratios: number[] = [];
    const render = async (ratio: number) => {
      ratios.push(ratio);
      return new Blob([new Uint8Array(Math.round(fullBytes * ratio * ratio))]);
    };
    return { ratios, render };
  };
  const dims = { width: 4000, height: 3000, limit: 1000 };

  it('CONTROL - an image that already fits is exported once, at full size', async () => {
    const { ratios, render } = fakeRender(900);
    const out = await exportFittingAnnotation(render, dims);
    expect(ratios).toEqual([1]);
    expect(out?.size).toBe(900);
  });

  it('re-renders smaller until the image fits, keeping the aspect ratio (one ratio for both edges)', async () => {
    const { ratios, render } = fakeRender(2500);
    const out = await exportFittingAnnotation(render, dims);
    expect(ratios[0]).toBe(1);
    expect(ratios.length).toBeGreaterThan(1);
    expect(ratios.length).toBeLessThanOrEqual(1 + ANNOTATION_MAX_STEPS);
    expect(ratios.every((r, i) => i === 0 || r < (ratios[i - 1] as number))).toBe(true);
    expect(out?.size).toBeLessThanOrEqual(dims.limit);
  });

  it('gives back the smallest export it made when nothing fits, so the caller can refuse it', async () => {
    const { ratios, render } = fakeRender(1_000_000);
    const out = await exportFittingAnnotation(render, dims);
    expect(ratios.length).toBeGreaterThan(1);
    expect(ratios.length).toBeLessThanOrEqual(1 + ANNOTATION_MAX_STEPS);
    // It stopped at the floor (shorter edge at the minimum) and never went below it.
    expect(ratios[ratios.length - 1] as number).toBeCloseTo(ANNOTATION_MIN_EDGE / 3000, 5);
    expect(out?.size).toBeGreaterThan(dims.limit);
    expect(out?.size).toBe(Math.round(1_000_000 * (ratios[ratios.length - 1] as number) ** 2));
  });

  it('keeps the last good export when a smaller render fails, and returns null when the first one does', async () => {
    let calls = 0;
    const flaky = async () => (calls++ === 0 ? new Blob([new Uint8Array(5000)]) : null);
    expect((await exportFittingAnnotation(flaky, dims))?.size).toBe(5000);
    expect(await exportFittingAnnotation(async () => null, dims)).toBeNull();
  });
});
