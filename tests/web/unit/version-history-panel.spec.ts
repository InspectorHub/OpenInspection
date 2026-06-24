// #181 Task 12a — VersionHistoryPanel UI behaviour.
//
// Renders the panel under happy-dom via react-dom/client (no RTL dep in this
// repo). JSX avoided so the file stays a .spec.ts and matches the vitest glob
// (tests/web/unit/**/*.spec.ts); assertions query the DOM directly and global
// `fetch` is mocked so no network is touched. The panel is mounted in a
// React-Router-free harness (it uses plain browser `fetch`, not loaders).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VersionHistoryPanel, formatRelativeTime } from '~/components/collab/VersionHistoryPanel';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

// react-dom schedules effects/microtasks; flush them inside act().
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

function rerender(node: React.ReactElement) {
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

// Queries against document.body — the Modal renders inline (not a portal) so it
// lives inside our container, but querying the body is robust either way.
function texts(sel: string): string[] {
  return Array.from(document.body.querySelectorAll(sel)).map((e) => e.textContent?.trim() ?? '');
}
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
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

const SNAPSHOTS = [
  { seq: 2, atMs: Date.now() - 60_000, byUserId: 'user-abc' },
  { seq: 1, atMs: Date.now() - 3_600_000, byUserId: null },
];

describe('formatRelativeTime', () => {
  it('formats recent/minute/hour/day buckets', () => {
    const now = 10_000_000_000;
    expect(formatRelativeTime(now - 1_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 120_000, now)).toBe('2 minutes ago');
    expect(formatRelativeTime(now - 3_600_000, now)).toBe('1 hour ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
  });
});

describe('VersionHistoryPanel', () => {
  it('1. opening fetches and lists snapshots; null actor renders "Auto-saved"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SNAPSHOTS));
    vi.stubGlobal('fetch', fetchMock);

    mount(createElement(VersionHistoryPanel, { open: true, onClose: vi.fn(), inspectionId: 'insp-1' }));
    await flush();

    // GET to the snapshots endpoint fired.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/inspections/insp-1/collab/snapshots',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );

    // Two rows + actor labels.
    const listItems = texts('li');
    expect(listItems).toHaveLength(2);
    expect(bodyText()).toContain('user-abc');
    expect(bodyText()).toContain('Auto-saved');
  });

  it('2. "Save version now" POSTs and refetches the list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([SNAPSHOTS[1]]))        // initial GET (1 row)
      .mockResolvedValueOnce(jsonResponse({ seq: 2, atMs: Date.now() })) // POST capture
      .mockResolvedValueOnce(jsonResponse(SNAPSHOTS));            // refetch GET (2 rows)
    vi.stubGlobal('fetch', fetchMock);

    mount(createElement(VersionHistoryPanel, { open: true, onClose: vi.fn(), inspectionId: 'insp-1' }));
    await flush();
    expect(texts('li')).toHaveLength(1);

    click(buttonByText(/save version now/i));
    await flush();

    // POST to snapshots fired.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/inspections/insp-1/collab/snapshots',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    // List re-rendered with the new snapshot (now 2 rows).
    expect(texts('li')).toHaveLength(2);
  });

  it('3. Restore opens the custom confirm modal and does NOT POST until confirmed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SNAPSHOTS));
    vi.stubGlobal('fetch', fetchMock);
    // happy-dom has no native window.confirm; stub it so we can assert the
    // component uses its OWN custom modal and never reaches for the native one.
    const confirmStub = vi.fn();
    vi.stubGlobal('confirm', confirmStub);

    mount(createElement(VersionHistoryPanel, { open: true, onClose: vi.fn(), inspectionId: 'insp-1' }));
    await flush();

    fetchMock.mockClear();
    click(buttonByText(/^restore$/i));
    await flush();

    // Custom confirm modal markup present — NOT a native window.confirm.
    expect(confirmStub).not.toHaveBeenCalled();
    expect(bodyText()).toContain('Restore this version?');
    expect(buttonByText(/restore version/i)).not.toBeNull();
    // No restore POST yet.
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/inspections/insp-1/collab/restore',
      expect.anything(),
    );
  });

  it('4. confirming POSTs restore with the right seq body and calls onRestored', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SNAPSHOTS))     // initial GET
      .mockResolvedValueOnce(jsonResponse({ ok: true }))  // restore POST
      .mockResolvedValueOnce(jsonResponse(SNAPSHOTS));    // refetch GET
    vi.stubGlobal('fetch', fetchMock);
    const onRestored = vi.fn();

    mount(createElement(VersionHistoryPanel, { open: true, onClose: vi.fn(), inspectionId: 'insp-1', onRestored }));
    await flush();

    // First row is seq 2.
    click(buttonByText(/^restore$/i));
    await flush();
    click(buttonByText(/restore version/i));
    await flush();

    const restoreCall = fetchMock.mock.calls.find((c) => c[0] === '/api/inspections/insp-1/collab/restore');
    expect(restoreCall).toBeTruthy();
    expect(restoreCall![1]).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse((restoreCall![1] as { body: string }).body)).toEqual({ seq: 2 });
    expect(onRestored).toHaveBeenCalledWith(2);
  });

  it('5. cancelling the confirm modal does NOT POST restore', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(SNAPSHOTS));
    vi.stubGlobal('fetch', fetchMock);
    const onRestored = vi.fn();

    mount(createElement(VersionHistoryPanel, { open: true, onClose: vi.fn(), inspectionId: 'insp-1', onRestored }));
    await flush();

    click(buttonByText(/^restore$/i));
    await flush();
    fetchMock.mockClear();
    click(buttonByText(/^cancel$/i));
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
    // Confirm modal closed.
    expect(bodyText()).not.toContain('Restore this version?');
  });

  it('6. empty list → empty state; failed GET → error state', async () => {
    // Empty list.
    const emptyFetch = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal('fetch', emptyFetch);
    mount(createElement(VersionHistoryPanel, { open: true, onClose: vi.fn(), inspectionId: 'insp-1' }));
    await flush();
    expect(bodyText()).toContain('No saved versions yet');

    // Failed GET.
    const failFetch = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    vi.stubGlobal('fetch', failFetch);
    rerender(createElement(VersionHistoryPanel, { open: false, onClose: vi.fn(), inspectionId: 'insp-1' }));
    rerender(createElement(VersionHistoryPanel, { open: true, onClose: vi.fn(), inspectionId: 'insp-1' }));
    await flush();
    expect(bodyText()).toContain('Could not load version history.');
  });
});
