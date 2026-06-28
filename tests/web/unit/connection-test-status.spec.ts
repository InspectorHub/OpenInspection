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
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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
