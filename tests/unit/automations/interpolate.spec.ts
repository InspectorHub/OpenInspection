// apps/openinspection/tests/unit/automation-core/interpolate.spec.ts
import { describe, it, expect } from 'vitest';
import { interpolate, referencedVars } from '../../../server/lib/automation-core/interpolate';

describe('interpolate', () => {
  it('replaces {{key}} with vars, missing → empty string (byte-identical to OI helper)', () => {
    expect(interpolate('Hi {{name}} from {{co}}', { name: 'Jane', co: 'Acme' })).toBe('Hi Jane from Acme');
    expect(interpolate('Hi {{missing}}!', {})).toBe('Hi !');
  });
  it('only matches \\w+ tokens', () => {
    expect(interpolate('{{a.b}} {{ok}}', { ok: 'X' })).toBe('{{a.b}} X');
  });
});

describe('referencedVars', () => {
  it('lists distinct {{name}} tokens', () => {
    expect(referencedVars('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
    expect(referencedVars('none here')).toEqual([]);
  });
});
