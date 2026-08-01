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

  /**
   * A LOCAL source is left alone.
   *
   * `?w=` asks our photo route for a smaller variant. A blob URL has no route
   * behind it, and a query appended to one does not weaken the request — it
   * makes the URL resolve to nothing. Every image picked off disk on Settings →
   * Profile is a blob URL, so this is the difference between Save working and
   * Save doing nothing at all: the cropper renders the raw URL, so the file
   * looks fine right up to the moment it fails to bake.
   */
  it('leaves a blob: URL untouched — appending a query would unresolve it', () => {
    const blob = 'blob:http://localhost:5174/6b1f-4e2a';
    expect(boundedSourceUrl(blob, 4096)).toBe(blob);
  });

  it('leaves a data: URL untouched', () => {
    const data = 'data:image/png;base64,AAAA';
    expect(boundedSourceUrl(data, 4096)).toBe(data);
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
