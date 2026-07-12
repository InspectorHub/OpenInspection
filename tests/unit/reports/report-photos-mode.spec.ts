import { describe, it, expect } from 'vitest';
import { derivePhotoMode } from '../../../server/lib/report-photos';

describe('derivePhotoMode', () => {
  it('full_pca -> appendix, light_commercial -> inline', () => {
    expect(derivePhotoMode({ reportTier: 'full_pca' })).toBe('appendix');
    expect(derivePhotoMode({ reportTier: 'light_commercial' })).toBe('inline');
  });

  it('defaults to inline for null / unknown tier (residential-compatible)', () => {
    expect(derivePhotoMode({ reportTier: null })).toBe('inline');
    expect(derivePhotoMode({ reportTier: 'something_else' })).toBe('inline');
    expect(derivePhotoMode({})).toBe('inline');
  });

  it('a valid override wins over the tier default', () => {
    expect(derivePhotoMode({ reportTier: 'full_pca', override: 'inline' })).toBe('inline');
    expect(derivePhotoMode({ reportTier: 'light_commercial', override: 'appendix' })).toBe('appendix');
  });

  it('ignores an invalid override and falls back to the tier default', () => {
    expect(derivePhotoMode({ reportTier: 'full_pca', override: 'bogus' })).toBe('appendix');
  });
});
