// tests/unit/pca-narrative.spec.ts
import { describe, it, expect } from 'vitest';
import { resolvePcaNarrative, PCA_NARRATIVE_SEED } from '../../server/lib/pca-narrative';

describe('resolvePcaNarrative', () => {
  it('returns the full seed for null (pre-launch reset / fresh report)', () => {
    expect(resolvePcaNarrative(null)).toEqual(PCA_NARRATIVE_SEED);
  });

  it('overlays stored non-empty blocks onto the seed', () => {
    const out = resolvePcaNarrative({ purpose: 'Custom purpose text.' });
    expect(out.purpose).toBe('Custom purpose text.');
    expect(out.scopeOfWork).toBe(PCA_NARRATIVE_SEED.scopeOfWork); // unset -> seed
  });

  it('treats an empty/whitespace block as unset (falls back to seed)', () => {
    const out = resolvePcaNarrative({ purpose: '   ' });
    expect(out.purpose).toBe(PCA_NARRATIVE_SEED.purpose);
  });

  it('tolerates the old 5-block shape without throwing', () => {
    const legacy = { execSummary: 'old', methodology: 'old', limitations: 'old', purpose: 'kept', buildingProfile: 'old' };
    const out = resolvePcaNarrative(legacy);
    expect(out.purpose).toBe('kept');
    expect(out.transmittalLetter).toBe(PCA_NARRATIVE_SEED.transmittalLetter);
  });

  it('seed has all 8 keys, each non-empty', () => {
    const keys = Object.keys(PCA_NARRATIVE_SEED);
    expect(keys).toHaveLength(9); // 8 free-prose + additionalConsiderations
    for (const k of keys) expect((PCA_NARRATIVE_SEED as Record<string, string>)[k].length).toBeGreaterThan(0);
  });
});
