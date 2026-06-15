import { describe, it, expect } from 'vitest';
import { resolveArchiveVersion } from '../../server/api/inspections-pdf-helpers';

describe('resolveArchiveVersion', () => {
  it('returns latest version when reportStatus is published', () => {
    expect(resolveArchiveVersion('published', [{ versionNumber: 3 }, { versionNumber: 2 }])).toBe(3);
    expect(resolveArchiveVersion('published', [{ versionNumber: 1 }])).toBe(1);
  });
  it('returns null for non-published report statuses', () => {
    expect(resolveArchiveVersion('in_progress', [{ versionNumber: 3 }])).toBeNull();
    expect(resolveArchiveVersion('submitted', [{ versionNumber: 1 }])).toBeNull();
  });
  it('returns null when published but no versions exist', () => {
    expect(resolveArchiveVersion('published', [])).toBeNull();
  });
});
