import { describe, it, expect } from 'vitest';
import { resolveProfile } from '../../../server/lib/report-style/resolve';

describe('resolveProfile', () => {
  const tenant = { defaultProfileId: 'signature' };

  it('inspection override wins over template and tenant', () => {
    const r = resolveProfile({ profileOverride: 'terra' }, { defaultProfileId: 'meridian' }, tenant);
    expect(r.id).toBe('terra');
  });

  it('template default wins over tenant when no inspection override', () => {
    const r = resolveProfile({ profileOverride: null }, { defaultProfileId: 'meridian' }, tenant);
    expect(r.id).toBe('meridian');
  });

  it('falls back to tenant default, then signature', () => {
    expect(resolveProfile({}, { defaultProfileId: null }, tenant).id).toBe('signature');
    expect(resolveProfile({}, null, { defaultProfileId: null }).id).toBe('signature');
    expect(resolveProfile({}, null, null).id).toBe('signature');
  });

  it('an unknown id falls back to signature (never throws)', () => {
    expect(resolveProfile({ profileOverride: 'ghost' }, null, tenant).id).toBe('signature');
  });

  it('field-level tweaks override the profile; NULL inherits', () => {
    const base = resolveProfile({}, null, tenant); // signature: strip, 2 cols
    expect(base.badgeLayout).toBe('strip');
    expect(base.photoColumns).toBe(2);
    const tweaked = resolveProfile(
      { badgeLayoutOverride: 'inline', reportPhotoColumns: 4 }, null, tenant,
    );
    expect(tweaked.badgeLayout).toBe('inline');
    expect(tweaked.photoColumns).toBe(4);
  });
});
