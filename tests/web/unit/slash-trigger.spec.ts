import { describe, it, expect } from 'vitest';
import { shouldTriggerSlash } from '~/lib/slash-trigger';

describe('shouldTriggerSlash', () => {
  it('triggers at position 0 (empty value or caret at start)', () => {
    expect(shouldTriggerSlash('', 0)).toBe(true);
    expect(shouldTriggerSlash('existing', 0)).toBe(true);
  });
  it('triggers after whitespace/newline/tab', () => {
    expect(shouldTriggerSlash('leak at ', 8)).toBe(true);
    expect(shouldTriggerSlash('line one\n', 9)).toBe(true);
    expect(shouldTriggerSlash('col\t', 4)).toBe(true);
  });
  it('does NOT trigger mid-word (URLs, "w/")', () => {
    expect(shouldTriggerSlash('http:', 5)).toBe(false);
    expect(shouldTriggerSlash('w', 1)).toBe(false);
  });
});
