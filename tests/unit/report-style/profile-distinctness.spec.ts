import { describe, it, expect } from 'vitest';
import { resolveProfile } from '../../../server/lib/report-style/resolve';
import { presetTokens } from '../../../app/lib/report-style/preset-tokens';

// The whole point of the three built-ins is that a report rendered under each
// looks visibly different. This pins the resolved-profile -> CSS-var chain
// (profiles.ts tokens -> resolveProfile -> presetTokens) that ReportView spreads
// into its root style. Full ReportView render is exercised by the Chrome E2E.
describe('the three built-ins produce distinct report CSS-var sets', () => {
  const varsFor = (id: string) =>
    presetTokens(resolveProfile({ profileOverride: id }, null, { defaultProfileId: 'signature' }).tokens) as Record<string, string>;

  it('meridian: uppercase headings + structural navy band', () => {
    const v = varsFor('meridian');
    expect(v['--report-heading-transform']).toBe('uppercase');
    expect(v['--report-band']).toBe('#0f172a');
  });

  it('terra: serif heading + double frame', () => {
    const v = varsFor('terra');
    expect(v['--report-heading-font']).toMatch(/serif/);
    expect(v['--report-frame']).toContain('double');
  });

  it('signature: neutral — no transform, band tracks the brand accent', () => {
    const v = varsFor('signature');
    expect(v['--report-heading-transform']).toBe('none');
    expect(v['--report-band']).toBe('var(--ih-primary)');
  });

  it('all three share the same complete var-key set (no undefined leaks)', () => {
    const keys = (id: string) => Object.keys(varsFor(id)).sort();
    expect(keys('meridian')).toEqual(keys('signature'));
    expect(keys('terra')).toEqual(keys('signature'));
    for (const id of ['signature', 'meridian', 'terra']) {
      expect(Object.values(varsFor(id)).every((x) => typeof x === 'string' && x.length > 0)).toBe(true);
    }
  });
});
