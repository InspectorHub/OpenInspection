// @vitest-environment happy-dom
/**
 * ConnectionTestStatus render tests.
 *
 * Asserts the shared "last tested" status line: empty → "Not tested yet";
 * latest success/failure → the right label + detail; the rest collapse into a
 * "Recent tests (N)" disclosure; and only rows matching `target` are shown.
 *
 * Plain createRoot + act harness (no router) — the component renders no <Form>.
 * Precedent: tests/web/unit/media-viewer.spec.ts.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The component reads the viewer's zone + format (#270), and those hooks bottom
// out in React Router's `useRouteLoaderData`, which invariants outside a data
// router — this harness has none. Stubbing the module is what the plan calls
// for; the values below are also what the shape assertions below depend on.
vi.mock('~/hooks/useSessionContext', () => ({
  useDisplayTimeZone: () => 'UTC',
  useChromeDateTimeFormat: () => ({ locale: 'en-US', dateFormat: 'iso', timeFormat: '24h' }),
}));

import {
  ConnectionTestStatus,
  type ConnectionTestResult,
} from '~/components/settings/ConnectionTestStatus';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

let container: HTMLElement;
let root: Root;

function render(results: ConnectionTestResult[], target: ConnectionTestResult['target']) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(ConnectionTestStatus, { results, target, nowMs: NOW }));
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function row(over: Partial<ConnectionTestResult>): ConnectionTestResult {
  return {
    target: 'sms', provider: null, ok: true, detail: null,
    testedByUserId: null, testedAt: NOW - MIN, ...over,
  };
}

describe('ConnectionTestStatus', () => {
  it('shows "Not tested yet" when no results match the target', () => {
    render([row({ target: 'email' })], 'sms');
    expect(container.textContent).toContain('Not tested yet');
  });

  it('renders a successful latest result', () => {
    render([row({ ok: true, detail: 'Test message sent.', testedAt: NOW - 5 * MIN })], 'sms');
    expect(container.textContent).toContain('Connected');
    expect(container.textContent).toContain('5m ago');
    expect(container.textContent).toContain('Test message sent.');
  });

  it('renders a failed latest result with its reason', () => {
    render([row({ ok: false, detail: 'SMS is not configured.' })], 'sms');
    expect(container.textContent).toContain('Failed');
    expect(container.textContent).toContain('SMS is not configured.');
  });

  it('picks the newest as latest and collapses the rest into history', () => {
    render(
      [
        row({ ok: true, testedAt: NOW - 2 * MIN, detail: 'newest' }),
        row({ ok: false, testedAt: NOW - 10 * MIN, detail: 'older' }),
        row({ ok: true, testedAt: NOW - 30 * MIN, detail: 'oldest' }),
      ],
      'sms',
    );
    expect(container.textContent).toContain('Connected'); // latest is the newest ok
    expect(container.textContent).toContain('Recent tests (2)');
  });

  // #270 — both stamps used to be `new Date(ms).toLocaleDateString()` /
  // `.toLocaleString()`, which read the BROWSER's locale and zone, so this panel
  // disagreed with every other timestamp in Settings for anyone outside the
  // tenant's zone. These assert the configured SHAPE reaches the render; under
  // the old code they read `11/14/2023` / `11/14/2023, 10:13:20 PM`.
  it('renders the older-than-a-week fallback in the configured date shape', () => {
    render([row({ testedAt: NOW - 30 * 24 * 60 * MIN })], 'sms');
    expect(container.textContent).toContain('2023-10-15');
  });

  it('renders the absolute-time tooltip in the configured shape and zone', () => {
    render([row({ testedAt: NOW })], 'sms');
    const title = container.querySelector('time')?.getAttribute('title') ?? '';
    // iso + 24h + UTC. A 12-hour meridiem here means the preference was ignored.
    expect(title).toBe('2023-11-14 · 22:13 UTC');
  });

  it('ignores rows belonging to other targets', () => {
    render(
      [
        row({ target: 'stripe', ok: false, detail: 'stripe failure' }),
        row({ target: 'sms', ok: true, detail: 'sms ok' }),
      ],
      'sms',
    );
    expect(container.textContent).toContain('sms ok');
    expect(container.textContent).not.toContain('stripe failure');
  });
});
