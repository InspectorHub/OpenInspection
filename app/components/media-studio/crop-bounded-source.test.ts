import { describe, it, expect } from 'vitest';
import { boundedSourceUrl, scaleCropToDecoded } from '~/components/media-studio/cropImage';

describe('boundedSourceUrl', () => {
  it('appends ?w=4096 when the url has no query', () => {
    expect(boundedSourceUrl('/p/orig.jpg', 4096)).toBe('/p/orig.jpg?w=4096');
  });
  it('replaces an existing ?w= with the bounded width (never upscales past the cap)', () => {
    expect(boundedSourceUrl('/p/orig.jpg?w=8000', 4096)).toBe('/p/orig.jpg?w=4096');
  });
  it('preserves other query params and appends &w=', () => {
    expect(boundedSourceUrl('/p/orig.jpg?v=2', 4096)).toBe('/p/orig.jpg?v=2&w=4096');
  });
});

describe('scaleCropToDecoded', () => {
  it('passes coords through unchanged when the decode matches the source dims', () => {
    const crop = { x: 100, y: 50, width: 800, height: 600 };
    expect(scaleCropToDecoded(crop, 4096, 4096)).toEqual(crop);
  });
  it('scales coords down when the decoded bitmap is smaller than the source (sized variant returned)', () => {
    // source long edge 8000 -> decoded long edge 4096 -> factor 0.512
    const crop = { x: 1000, y: 500, width: 2000, height: 1000 };
    const out = scaleCropToDecoded(crop, 8000, 4096);
    expect(out).toEqual({ x: 512, y: 256, width: 1024, height: 512 });
  });
});
