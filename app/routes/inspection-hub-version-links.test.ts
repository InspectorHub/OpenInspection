// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { versionDiffHref } from '~/lib/inspection-hub-helpers';

// IA-40 — the version-diff page had zero inbound links; the Report card's
// Versions list is now the entry point. The href builder is the pure core: it
// wires each version to a diff against its immediate predecessor, and refuses a
// link for version 1 (there is no earlier version to diff against).
describe('versionDiffHref', () => {
  it('diffs a version against its immediate predecessor', () => {
    expect(versionDiffHref('abc', 2)).toBe('/version-diff/abc?n=2&from=1');
    expect(versionDiffHref('abc', 3)).toBe('/version-diff/abc?n=3&from=2');
  });

  it('returns null for version 1 (nothing earlier to diff against)', () => {
    expect(versionDiffHref('abc', 1)).toBeNull();
  });

  it('returns null for non-positive version numbers', () => {
    expect(versionDiffHref('abc', 0)).toBeNull();
  });
});
