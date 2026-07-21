import { describe, it, expect } from 'vitest';
import { presetTokens } from '../../../app/lib/report-style/preset-tokens';

describe('presetTokens', () => {
  it('returns a CSS-var map with the --report- prefix', () => {
    const vars = presetTokens({ headingTransform: 'uppercase' }) as Record<string, string>;
    expect(vars['--report-heading-transform']).toBe('uppercase');
  });

  it('sparse overlay: absent keys fall back to base defaults', () => {
    const vars = presetTokens({}) as Record<string, string>;
    expect(vars['--report-heading-transform']).toBe('none'); // base
    expect(vars['--report-radius']).toBe('5px'); // base
  });

  it('ignores unknown keys (forward-compat with Phase-2 tokens)', () => {
    const vars = presetTokens({ futureKey: 'x' } as Record<string, string>) as Record<string, string>;
    expect(vars).not.toHaveProperty('--report-future-key');
  });
});
