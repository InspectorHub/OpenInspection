// #181 PR-H (Task H2) — VersionCompare modal + VersionHistoryPanel compare flow.
//
// happy-dom + react-dom/client (no RTL in this repo). JSX avoided so the file
// stays a .spec.ts under the vitest glob. The first block drives the pure
// VersionCompare shell (callback wiring with the OLD value); the second drives
// the panel's Compare action (fetch the :seq projection → diff → render rows).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VersionCompare } from '~/components/collab/VersionCompare';
import { VersionHistoryPanel } from '~/components/collab/VersionHistoryPanel';
import type { FindingDiff } from '~/lib/collab/snapshot-diff';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function buttonByText(re: RegExp): HTMLButtonElement | null {
  const buttons = Array.from(document.body.querySelectorAll('button')) as HTMLButtonElement[];
  return buttons.find((b) => re.test(b.textContent ?? '')) ?? null;
}
function bodyText(): string {
  return document.body.textContent ?? '';
}
function click(el: Element | null) {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('VersionCompare (shell)', () => {
  const diffs: FindingDiff[] = [
    {
      findingKey: '_default:s1:i1',
      scalarChanges: [{ field: 'rating', from: 'NI', to: 'RR' }],
      nestedChanged: false,
    },
  ];

  it('renders the field diff (from → to) and recovers the OLD value', () => {
    const onRecoverField = vi.fn();
    const onRestoreWhole = vi.fn();
    mount(
      createElement(VersionCompare, {
        open: true,
        onClose: vi.fn(),
        fromLabel: 'Version #3',
        toLabel: 'Current',
        diffs,
        onRecoverField,
        onRestoreWhole,
      }),
    );

    // Both the old and the new scalar values are shown.
    expect(bodyText()).toContain('NI');
    expect(bodyText()).toContain('RR');
    expect(bodyText()).toContain('rating');

    // "Recover this value" passes the OLD value ('NI').
    click(buttonByText(/recover this value/i));
    expect(onRecoverField).toHaveBeenCalledWith('_default:s1:i1', 'rating', 'NI');

    // "Restore entire version" calls the whole-version restore.
    click(buttonByText(/restore entire version/i));
    expect(onRestoreWhole).toHaveBeenCalledTimes(1);
  });

  it('hides single-value recover when onRecoverField is absent but keeps restore', () => {
    const onRestoreWhole = vi.fn();
    mount(
      createElement(VersionCompare, {
        open: true,
        onClose: vi.fn(),
        fromLabel: 'Version #3',
        toLabel: 'Current',
        diffs,
        onRestoreWhole,
      }),
    );
    // The button still renders but is disabled (no handler).
    const recover = buttonByText(/recover this value/i);
    expect(recover).not.toBeNull();
    expect(recover!.disabled).toBe(true);
    expect(buttonByText(/restore entire version/i)).not.toBeNull();
  });

  it('shows the empty state when there are no diffs', () => {
    mount(
      createElement(VersionCompare, {
        open: true,
        onClose: vi.fn(),
        fromLabel: 'Version #3',
        toLabel: 'Current',
        diffs: [],
      }),
    );
    expect(bodyText()).toContain('No differences');
  });
});

describe('VersionHistoryPanel — Compare action', () => {
  const SNAPSHOTS = [{ seq: 2, atMs: Date.now() - 60_000, byUserId: 'user-abc', reason: 'connect' }];
  const CURRENT = { '_default:s1:i1': { rating: 'RR' } };
  const SNAPSHOT_DETAIL = {
    seq: 2,
    atMs: Date.now() - 60_000,
    byUserId: 'user-abc',
    reason: 'connect',
    projection: { '_default:s1:i1': { rating: 'NI' } },
  };

  it('labels a connect snapshot as the pre-merge boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SNAPSHOTS));
    vi.stubGlobal('fetch', fetchMock);

    mount(
      createElement(VersionHistoryPanel, {
        open: true,
        onClose: vi.fn(),
        inspectionId: 'insp-1',
        currentResults: CURRENT,
      }),
    );
    await flush();
    expect(bodyText()).toContain('Auto-saved before a reconnect');
  });

  it('Compare fetches the snapshot :seq projection and renders the field diff', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SNAPSHOTS))       // initial GET list
      .mockResolvedValueOnce(jsonResponse(SNAPSHOT_DETAIL)); // GET :seq detail
    vi.stubGlobal('fetch', fetchMock);

    mount(
      createElement(VersionHistoryPanel, {
        open: true,
        onClose: vi.fn(),
        inspectionId: 'insp-1',
        currentResults: CURRENT,
      }),
    );
    await flush();

    click(buttonByText(/^compare$/i));
    await flush();

    // It fetched the per-seq projection endpoint.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/inspections/insp-1/collab/snapshots/2',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
    // The compare modal shows the rating diff (NI → RR).
    expect(bodyText()).toContain('Compare versions');
    expect(bodyText()).toContain('rating');
    expect(bodyText()).toContain('NI');
    expect(bodyText()).toContain('RR');
  });

  it('does not render the Compare action when currentResults is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SNAPSHOTS));
    vi.stubGlobal('fetch', fetchMock);

    mount(
      createElement(VersionHistoryPanel, {
        open: true,
        onClose: vi.fn(),
        inspectionId: 'insp-1',
      }),
    );
    await flush();
    expect(buttonByText(/^compare$/i)).toBeNull();
  });
});
