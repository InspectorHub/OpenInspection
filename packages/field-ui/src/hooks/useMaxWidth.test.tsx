// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useMaxWidth } from './useBreakpoint';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const calls = { add: 0, remove: 0 };
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return matches; },
    addEventListener: (_: string, fn: () => void) => { calls.add += 1; listeners.add(fn); },
    removeEventListener: (_: string, fn: () => void) => { calls.remove += 1; listeners.delete(fn); },
  }));
  return { calls, set: (next: boolean) => { matches = next; act(() => listeners.forEach((fn) => fn())); } };
}

describe('useMaxWidth', () => {
  it('subscribes once for as many renders as it takes, not once per render', () => {
    const mq = stubMatchMedia(false);
    const { rerender } = renderHook(({ px }) => useMaxWidth(px), { initialProps: { px: 767 } });
    rerender({ px: 767 });
    rerender({ px: 767 });
    rerender({ px: 767 });
    expect(mq.calls.add).toBe(1);
    expect(mq.calls.remove).toBe(0);
  });

  it('CONTROL - a different width is a different query and resubscribes', () => {
    const mq = stubMatchMedia(false);
    const { rerender } = renderHook(({ px }) => useMaxWidth(px), { initialProps: { px: 767 } });
    rerender({ px: 1023 });
    expect(mq.calls.add).toBe(2);
    expect(mq.calls.remove).toBe(1);
  });

  it('follows the viewport', () => {
    const mq = stubMatchMedia(false);
    const { result } = renderHook(() => useMaxWidth(767));
    expect(result.current).toBe(false);
    mq.set(true);
    expect(result.current).toBe(true);
  });
});
