import { describe, it, expect } from 'vitest';
import { REGISTRY, getDescriptor } from '../../../server/lib/email-templates/registry';

describe('email template registry', () => {
  it('has exactly 19 descriptors', () => {
    expect(REGISTRY.length).toBe(19);
  });
  it('every trigger is unique', () => {
    const t = REGISTRY.map(d => d.trigger);
    expect(new Set(t).size).toBe(19);
  });
  it('marks exactly one non-editable (platform) trigger: password-reset', () => {
    const platform = REGISTRY.filter(d => !d.editable).map(d => d.trigger);
    expect(platform).toEqual(['password-reset']);
  });
  it('marks exactly the two required triggers', () => {
    const req = REGISTRY.filter(d => d.required).map(d => d.trigger).sort();
    expect(req).toEqual(['agreement-signed', 'evidence-pack']);
  });
  it('every cta references an existing block key + declared variable', () => {
    for (const d of REGISTRY) {
      if (!d.cta) continue;
      expect(d.blocks.some(b => b.key === d.cta!.labelBlockKey)).toBe(true);
      expect(d.variables.some(v => v.name === d.cta!.urlVar)).toBe(true);
    }
  });
  it('every {{token}} used in subject/blocks is a declared variable', () => {
    const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    for (const d of REGISTRY) {
      const allowed = new Set(d.variables.map(v => v.name));
      const strings = [d.defaultSubject, ...d.blocks.map(b => b.default)];
      for (const s of strings) {
        for (const m of s.matchAll(TOKEN)) {
          expect(allowed.has(m[1])).toBe(true);
        }
      }
    }
  });
  it('getDescriptor returns by trigger and undefined for unknown', () => {
    expect(getDescriptor('report-ready')?.name).toBeTruthy();
    expect(getDescriptor('nope')).toBeUndefined();
  });
});
