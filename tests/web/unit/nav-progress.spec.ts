/**
 * NavProgress render tests (issue #202, Tier 1).
 *
 * The bar keys off `navigation.state`: hidden while idle, visible (a fixed top
 * sliver) while a navigation is in flight, and it completes + fades once the
 * state returns to "idle" — including the error/404 path, where a thrown loader
 * Response still settles navigation back to "idle" (no stuck-forever bar).
 *
 * `useNavigation` is mocked via a mutable state holder so we can drive the
 * transitions; fake timers cover the ramp/complete/fade scheduling.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let navState: 'idle' | 'loading' | 'submitting' = 'idle';
vi.mock('react-router', () => ({
  useNavigation: () => ({ state: navState }),
}));

import { NavProgress } from '~/components/NavProgress';

let container: HTMLElement;
let root: Root;

function render() {
  act(() => {
    root.render(createElement(NavProgress));
  });
}

function bar(): HTMLElement | null {
  return container.querySelector('div[aria-hidden]');
}

beforeEach(() => {
  vi.useFakeTimers();
  navState = 'idle';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('NavProgress', () => {
  it('renders nothing while navigation is idle', () => {
    render();
    expect(bar()).toBeNull();
  });

  it('shows the bar while a navigation is in flight', () => {
    navState = 'loading';
    render();
    const inner = bar()?.firstElementChild as HTMLElement | undefined;
    expect(bar()).not.toBeNull();
    expect(inner?.style.width).toBe('8%');
    // Ramps toward 90% without reaching it.
    act(() => vi.advanceTimersByTime(600));
    const w = parseFloat((bar()?.firstElementChild as HTMLElement).style.width);
    expect(w).toBeGreaterThan(8);
    expect(w).toBeLessThan(90);
  });

  it('completes and fades out once navigation settles back to idle', () => {
    navState = 'loading';
    render();
    expect(bar()).not.toBeNull();

    // Navigation commits (or errors) → state returns to idle.
    navState = 'idle';
    render();
    expect((bar()?.firstElementChild as HTMLElement).style.width).toBe('100%');

    // After the fade window the bar unmounts entirely (no stuck bar).
    act(() => vi.advanceTimersByTime(600));
    expect(bar()).toBeNull();
  });
});
