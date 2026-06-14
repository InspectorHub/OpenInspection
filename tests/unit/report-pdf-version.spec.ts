import { describe, it, expect } from 'vitest';
import { resolveArchiveVersion } from '../../server/api/inspections-pdf-helpers';

describe('resolveArchiveVersion', () => {
  it('returns latest published version for published/delivered', () => {
    expect(resolveArchiveVersion('published', [{ versionNumber: 3 }, { versionNumber: 2 }])).toBe(3);
    expect(resolveArchiveVersion('delivered', [{ versionNumber: 1 }])).toBe(1);
  });
  it('returns null for draft/in_progress/completed', () => {
    expect(resolveArchiveVersion('draft', [{ versionNumber: 3 }])).toBeNull();
    expect(resolveArchiveVersion('completed', [])).toBeNull();
  });
  it('returns null when published but no versions exist', () => {
    expect(resolveArchiveVersion('published', [])).toBeNull();
  });
});
