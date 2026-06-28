/**
 * RouteSkeleton matching tests (issue #202, Tier 2).
 *
 * The auth-layout shows a loading skeleton during navigation; it should pick a
 * route-matched skeleton (the inspections list mimics its real shape) and fall
 * back to the generic page skeleton for everything else. We assert via each
 * skeleton's distinct sr-only label.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouteSkeleton } from '~/components/RouteSkeleton';

let container: HTMLElement;
let root: Root;

function renderAt(pathname: string): string {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(RouteSkeleton, { pathname }));
  });
  return container.textContent ?? '';
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('RouteSkeleton', () => {
  it('renders the inspections-list skeleton for /inspections (exact)', () => {
    expect(renderAt('/inspections')).toContain('Loading inspections');
    expect(renderAt('/inspections/')).toContain('Loading inspections');
  });

  it('falls back to the generic skeleton for inspection detail/editor', () => {
    expect(renderAt('/inspections/abc123')).toContain('Loading page');
    expect(renderAt('/inspections/abc123/edit')).toContain('Loading page');
  });

  it('falls back to the generic skeleton for unrelated routes', () => {
    expect(renderAt('/contacts')).toContain('Loading page');
    expect(renderAt('/settings/communication')).toContain('Loading page');
  });
});
