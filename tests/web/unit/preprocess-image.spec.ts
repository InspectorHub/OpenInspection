import { describe, it, expect } from 'vitest';
import { computeTargetDimensions, UPLOAD_MAX_LONG_EDGE } from '~/components/media-studio/preprocessImage';

describe('computeTargetDimensions', () => {
  it('exposes a 2560 long-edge cap', () => {
    expect(UPLOAD_MAX_LONG_EDGE).toBe(2560);
  });
  it('downscales a landscape image so the long edge is the cap', () => {
    expect(computeTargetDimensions(4032, 3024)).toEqual({ width: 2560, height: 1920 });
  });
  it('downscales a portrait image so the long edge is the cap', () => {
    expect(computeTargetDimensions(3024, 4032)).toEqual({ width: 1920, height: 2560 });
  });
  it('never upscales a small image', () => {
    expect(computeTargetDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('rounds to integer pixels', () => {
    const d = computeTargetDimensions(4000, 2999);
    expect(Number.isInteger(d.width)).toBe(true);
    expect(Number.isInteger(d.height)).toBe(true);
    expect(Math.max(d.width, d.height)).toBe(2560);
  });
});
