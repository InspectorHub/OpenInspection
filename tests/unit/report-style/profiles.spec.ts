import { describe, it, expect } from 'vitest';
import { BUILTIN_PROFILES, BASE_TOKENS, DEFAULT_PROFILE_ID } from '../../../server/lib/report-style/profiles';

describe('BUILTIN_PROFILES', () => {
  it('ships the three curated profiles keyed by stable id', () => {
    expect(Object.keys(BUILTIN_PROFILES).sort()).toEqual(['meridian', 'signature', 'terra']);
    for (const id of Object.keys(BUILTIN_PROFILES)) {
      expect(BUILTIN_PROFILES[id].id).toBe(id);
    }
  });

  it('defaults to signature and every profile inherits brand colour (colour:null)', () => {
    expect(DEFAULT_PROFILE_ID).toBe('signature');
    for (const p of Object.values(BUILTIN_PROFILES)) {
      expect(p.colour).toBeNull();
      expect(p.schemaVersion).toBe(1);
      expect(['strip', 'inline']).toContain(p.badgeLayout);
      expect(p.photoColumns).toBeGreaterThanOrEqual(1);
      expect(p.photoColumns).toBeLessThanOrEqual(4);
    }
  });

  it('profile tokens are a sparse overlay (meridian/terra differ from base on their signature axes)', () => {
    expect(BUILTIN_PROFILES.meridian.tokens.headingTransform).toBe('uppercase');
    expect(BUILTIN_PROFILES.terra.tokens.headingFontFamily).toMatch(/serif/);
    expect(BASE_TOKENS.headingTransform).toBe('none');
  });
});
