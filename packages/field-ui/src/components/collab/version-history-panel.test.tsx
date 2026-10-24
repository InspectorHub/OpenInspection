// @vitest-environment happy-dom
// #181 Task 12a — VersionHistoryPanel UI behaviour, on the provider and a fake data source: the panel reads and
// writes through `resources.versionHistory` and sends nothing of its own. The collab-namespace requests those
// calls become are pinned by the web adapter tests (app/lib/field/web-reads.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FieldDataSourceProvider } from '../../context';
import type { VersionSnapshotEntry } from '../../data-source-types';
import { createEmptyEditorData, createFakeDataSource, createFakeVersionHistory } from '../../testing/fake-data-source';
import type { FakeVersionHistory } from '../../testing/fake-data-source';
import { VersionHistoryPanel, formatRelativeTime } from './VersionHistoryPanel';

const UTC_US = { locale: 'en-US', dateFormat: 'us' as const, timeFormat: '12h' as const };

let container: HTMLDivElement | null = null;
let root: Root | null = null;

// react-dom schedules effects/microtasks; flush them inside act().
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function panel(versionHistory: FakeVersionHistory | null, props: Partial<React.ComponentProps<typeof VersionHistoryPanel>> = {}) {
  const fake = createFakeDataSource({
    data: createEmptyEditorData(),
    resources: versionHistory ? { versionHistory } : {},
  });
  return (
    <FieldDataSourceProvider dataSource={fake}>
      <VersionHistoryPanel open onClose={vi.fn()} inspectionId="insp-1" {...props} />
    </FieldDataSourceProvider>
  );
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

const SNAPSHOTS: VersionSnapshotEntry[] = [
  { seq: 2, atMs: Date.now() - 60_000, byUserId: 'user-abc' },
  { seq: 1, atMs: Date.now() - 3_600_000, byUserId: null },
];

describe('formatRelativeTime', () => {
  it('formats recent/minute/hour/day buckets', () => {
    const now = 10_000_000_000;
    expect(formatRelativeTime(now - 1_000, now, 'UTC', UTC_US)).toBe('just now');
    expect(formatRelativeTime(now - 120_000, now, 'UTC', UTC_US)).toBe('2 minutes ago');
    expect(formatRelativeTime(now - 3_600_000, now, 'UTC', UTC_US)).toBe('1 hour ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now, 'UTC', UTC_US)).toBe('2 days ago');
  });

  // #270 — the >7d fallback was `new Date(atMs).toLocaleDateString()`: the
  // BROWSER's locale and zone, so two collaborators could read two different
  // dates off the same snapshot. Shape and zone now come from the tenant.
  it('renders the older-than-a-week fallback in the tenant date shape and zone', () => {
    const atMs = Date.UTC(2026, 8, 11, 23, 30); // 2026-09-11T23:30Z
    const now = atMs + 30 * 86_400_000;
    expect(formatRelativeTime(atMs, now, 'UTC', UTC_US)).toBe('Sep 11, 2026');
    expect(formatRelativeTime(atMs, now, 'UTC', { ...UTC_US, dateFormat: 'iso' })).toBe('2026-09-11');
    // A zone that rolls the instant back a day proves the zone is honoured too.
    expect(formatRelativeTime(atMs, now, 'America/New_York', UTC_US)).toBe('Sep 11, 2026');
    expect(formatRelativeTime(atMs, now, 'Asia/Tokyo', UTC_US)).toBe('Sep 12, 2026');
  });
});

describe('VersionHistoryPanel', () => {
  it('1. opening lists the snapshots; null actor renders "Auto-saved"', async () => {
    const vh = createFakeVersionHistory(SNAPSHOTS);
    mount(panel(vh));
    await flush();

    expect(vh.lists).toBe(1);
    expect(texts('li')).toHaveLength(2);
    expect(bodyText()).toContain('user-abc');
    expect(bodyText()).toContain('Auto-saved');
  });

  it('2. "Save version now" captures and re-lists', async () => {
    const vh = createFakeVersionHistory([SNAPSHOTS[1]!]);
    mount(panel(vh));
    await flush();
    expect(texts('li')).toHaveLength(1);

    vh.setSnapshots(SNAPSHOTS);
    click(buttonByText(/save version now/i));
    await flush();

    expect(vh.captures).toEqual(['insp-1']);
    // List re-rendered with the new snapshot (now 2 rows).
    expect(vh.lists).toBe(2);
    expect(texts('li')).toHaveLength(2);
  });

  it('2b. a refused capture shows the error state instead of a silent success', async () => {
    const vh = createFakeVersionHistory(SNAPSHOTS);
    mount(panel(vh));
    await flush();
    vh.failCapture('HTTP 500');
    click(buttonByText(/save version now/i));
    await flush();
    expect(bodyText()).toContain('Could not load version history.');
  });

  it('3. Restore opens the custom confirm modal and does NOT restore until confirmed', async () => {
    const vh = createFakeVersionHistory(SNAPSHOTS);
    // happy-dom has no native window.confirm; stub it so we can assert the
    // component uses its OWN custom modal and never reaches for the native one.
    const confirmStub = vi.fn();
    vi.stubGlobal('confirm', confirmStub);
    mount(panel(vh));
    await flush();

    click(buttonByText(/^restore$/i));
    await flush();

    expect(confirmStub).not.toHaveBeenCalled();
    expect(bodyText()).toContain('Restore this version?');
    expect(buttonByText(/restore version/i)).not.toBeNull();
    expect(vh.restores).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('4. confirming restores the right seq, re-lists and calls onRestored', async () => {
    const vh = createFakeVersionHistory(SNAPSHOTS);
    const onRestored = vi.fn();
    mount(panel(vh, { onRestored }));
    await flush();

    // First row is seq 2.
    click(buttonByText(/^restore$/i));
    await flush();
    click(buttonByText(/restore version/i));
    await flush();

    expect(vh.restores).toEqual([{ inspectionId: 'insp-1', seq: 2 }]);
    expect(vh.lists).toBe(2);
    expect(onRestored).toHaveBeenCalledWith(2);
  });

  it('4b. a refused restore shows the host\'s sentence, keeps the dialog open and does not call onRestored', async () => {
    const vh = createFakeVersionHistory(SNAPSHOTS);
    vh.failRestore('That version is gone');
    const onRestored = vi.fn();
    mount(panel(vh, { onRestored }));
    await flush();
    click(buttonByText(/^restore$/i));
    await flush();
    click(buttonByText(/restore version/i));
    await flush();
    expect(bodyText()).toContain('That version is gone');
    expect(bodyText()).toContain('Restore this version?');
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('5. cancelling the confirm modal does NOT restore', async () => {
    const vh = createFakeVersionHistory(SNAPSHOTS);
    const onRestored = vi.fn();
    mount(panel(vh, { onRestored }));
    await flush();

    click(buttonByText(/^restore$/i));
    await flush();
    click(buttonByText(/^cancel$/i));
    await flush();

    expect(vh.restores).toEqual([]);
    expect(onRestored).not.toHaveBeenCalled();
    expect(bodyText()).not.toContain('Restore this version?');
  });

  it('6. empty list → empty state; failed read → error state; a host with no history → error state', async () => {
    const vh = createFakeVersionHistory([]);
    mount(panel(vh));
    await flush();
    expect(bodyText()).toContain('No saved versions yet');

    vh.failList();
    rerender(panel(vh, { open: false }));
    rerender(panel(vh, { open: true }));
    await flush();
    expect(bodyText()).toContain('Could not load version history.');

    rerender(panel(null, { open: false }));
    rerender(panel(null, { open: true }));
    await flush();
    expect(bodyText()).toContain('Could not load version history.');
  });
});
