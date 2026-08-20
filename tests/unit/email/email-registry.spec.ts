import { describe, it, expect } from 'vitest';
import { REGISTRY, getDescriptor } from '../../../server/lib/email-templates/registry';
import { sampleDataFor } from '../../../server/lib/email-templates/sample-data';

describe('email template registry', () => {
  // A hand-maintained count is the only tripwire for a template being DELETED
  // by accident — nothing else in the suite notices a shrinking registry (an
  // orphaned class is legal, since a class may exist before its template does).
  it('has exactly 29 descriptors — bump deliberately when adding one', () => {
    expect(REGISTRY.length).toBe(29);
  });
  it('every trigger is unique', () => {
    const t = REGISTRY.map(d => d.trigger);
    expect(new Set(t).size).toBe(REGISTRY.length);
  });
  it('marks exactly the platform-owned triggers non-editable', () => {
    // Non-editable == "this is OUR message, on OUR footing": account recovery,
    // our own billing, and one compliance statement. A tenant rewriting any of
    // them would be rewriting something they are not the author of.
    //
    // `destruction-incomplete` is non-editable for a stronger reason than the
    // billing pair: it reports, under a counsel ruling, that data the recipient
    // asked us to erase still exists. A tenant able to edit it could soften or
    // contradict the fact being reported about their own deletion.
    const platform = REGISTRY.filter(d => !d.editable).map(d => d.trigger);
    expect(platform).toEqual([
        'password-reset', 'usage-quota-warning', 'usage-quota-reached', 'destruction-incomplete',
    ]);
  });
  // Which triggers are `required` is no longer asserted here. A hardcoded pair
  // in this file was a snapshot of the answer, and the answer was wrong: only
  // 2 of 20 were marked, so a tenant could disable the password-reset email and
  // lock every user out of account recovery. The authority is now the class
  // vocabulary, and `tests/unit/notifications/classes.spec.ts` asserts three
  // things this line could not — that every trigger HAS a class, that the
  // operator's kill switch agrees with the recipient's, and that a newly added
  // notification fails the build until someone decides whether it may be muted.
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
  it('every declared variable has a preview example', () => {
    // `sampleDataFor` falls back to the literal `{name}` when a variable has no
    // example, so the preview an admin uses to check their copy silently shows
    // `{loginUrl}` where the button link should be — and the CTA renders with a
    // junk href. Nothing failed; it just looked wrong to whoever opened it.
    const missing: string[] = [];
    for (const d of REGISTRY) {
      const sample = sampleDataFor(d);
      for (const v of d.variables) {
        if (sample[v.name] === `{${v.name}}`) missing.push(`${d.trigger}.${v.name}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('getDescriptor returns by trigger and undefined for unknown', () => {
    expect(getDescriptor('report-ready')?.name).toBeTruthy();
    expect(getDescriptor('nope')).toBeUndefined();
  });
});
