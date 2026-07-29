/**
 * Task 4 (two-layer role model) — the inspector portal reads publish from the
 * server's capability set, not from the role string (IA-95 frontend half).
 */
import { describe, it, expect } from 'vitest';
import { publishCapFromMe } from '~/lib/inspector-portal-helpers';

describe('inspector portal publish capability', () => {
  it('is false when the server withdrew publish, even though the role is inspector', () => {
    expect(publishCapFromMe({
      data: { user: { role: 'inspector' }, capabilities: { publish: false } },
    })).toBe(false);
  });

  it('is true when the server granted publish', () => {
    expect(publishCapFromMe({
      data: { user: { role: 'inspector' }, capabilities: { publish: true } },
    })).toBe(true);
  });

  it('resolves false for a body with no capabilities — the pre-Task-3 shape', () => {
    // The old code answered TRUE here by looking at the role. False is the
    // safe wrong answer: submit-only flow, never a button the API refuses.
    expect(publishCapFromMe({ data: { user: { role: 'inspector' } } })).toBe(false);
  });
});
