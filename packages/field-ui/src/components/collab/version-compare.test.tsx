// @vitest-environment happy-dom
// #181 PR-H (Task H2) — VersionCompare modal + VersionHistoryPanel compare flow.
//
// The first block drives the pure VersionCompare shell (callback wiring with the OLD value); the second drives the
// panel's Compare action on a fake data source (read the snapshot's projection through `versionHistory.get`, diff,
// render rows).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FieldDataSourceProvider } from '../../context';
import type { VersionSnapshotEntry } from '../../data-source-types';
import { createEmptyEditorData, createFakeDataSource, createFakeVersionHistory } from '../../testing/fake-data-source';
import type { FakeVersionHistory } from '../../testing/fake-data-source';
import type { FindingDiff } from '../../shared/snapshot-diff';
import { VersionCompare } from './VersionCompare';
import { VersionHistoryPanel } from './VersionHistoryPanel';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
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
    const props = {
      open: true,
      onClose: vi.fn(),
      fromLabel: 'Version #3',
      toLabel: 'Current',
      diffs,
      onRecoverField,
      onRestoreWhole,
    };
    mount(<VersionCompare {...props} />);

    // Both the old and the new scalar values are shown.
    expect(bodyText()).toContain('NI');
    expect(bodyText()).toContain('RR');
    expect(bodyText()).toContain('rating');

    // "Recover this value" passes the OLD value ('NI').
    click(buttonByText(/recover this value/i));
    expect(onRecoverField).toHaveBeenCalledWith('_default:s1:i1', 'rating', 'NI');

    // The parent holds `busy` while a recovery runs and drops it when that finishes; only then is
    // the next action accepted.
    act(() => root!.render(<VersionCompare {...props} busy />));
    act(() => root!.render(<VersionCompare {...props} busy={false} />));

    // "Restore entire version" calls the whole-version restore.
    click(buttonByText(/restore entire version/i));
    expect(onRestoreWhole).toHaveBeenCalledTimes(1);
  });

  it('hides single-value recover when onRecoverField is absent but keeps restore', () => {
    const onRestoreWhole = vi.fn();
    mount(<VersionCompare open onClose={vi.fn()} fromLabel="Version #3" toLabel="Current" diffs={diffs} onRestoreWhole={onRestoreWhole} />);
    // The button still renders but is disabled (no handler).
    const recover = buttonByText(/recover this value/i);
    expect(recover).not.toBeNull();
    expect(recover!.disabled).toBe(true);
    expect(buttonByText(/restore entire version/i)).not.toBeNull();
  });

  it('shows the empty state when there are no diffs', () => {
    mount(<VersionCompare open onClose={vi.fn()} fromLabel="Version #3" toLabel="Current" diffs={[]} />);
    expect(bodyText()).toContain('No differences');
  });
});

describe('VersionHistoryPanel — Compare action', () => {
  const SNAPSHOTS: VersionSnapshotEntry[] = [{ seq: 2, atMs: Date.now() - 60_000, byUserId: 'user-abc', reason: 'connect' }];
  const CURRENT = { '_default:s1:i1': { rating: 'RR' } };

  function panel(vh: FakeVersionHistory, withCurrent: boolean) {
    const fake = createFakeDataSource({ data: createEmptyEditorData(), resources: { versionHistory: vh } });
    return (
      <FieldDataSourceProvider dataSource={fake}>
        <VersionHistoryPanel open onClose={vi.fn()} inspectionId="insp-1" {...(withCurrent ? { currentResults: CURRENT } : {})} />
      </FieldDataSourceProvider>
    );
  }

  it('labels a connect snapshot as the pre-merge boundary', async () => {
    mount(panel(createFakeVersionHistory(SNAPSHOTS), true));
    await flush();
    expect(bodyText()).toContain('Auto-saved before a reconnect');
  });

  it('Compare reads the snapshot projection and renders the field diff', async () => {
    const vh = createFakeVersionHistory(SNAPSHOTS);
    vh.setContent({ projection: { '_default:s1:i1': { rating: 'NI' } } as never });
    mount(panel(vh, true));
    await flush();

    click(buttonByText(/^compare$/i));
    await flush();

    expect(vh.gets).toEqual([{ inspectionId: 'insp-1', seq: 2 }]);
    // The compare modal shows the rating diff (NI → RR).
    expect(bodyText()).toContain('Compare versions');
    expect(bodyText()).toContain('rating');
    expect(bodyText()).toContain('NI');
    expect(bodyText()).toContain('RR');
  });

  it('closes the compare again when the projection cannot be read', async () => {
    const vh = createFakeVersionHistory(SNAPSHOTS);
    vh.failGet();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount(panel(vh, true));
    await flush();
    click(buttonByText(/^compare$/i));
    await flush();
    expect(vh.gets).toHaveLength(1);
    expect(bodyText()).not.toContain('Compare versions');
  });

  it('does not render the Compare action when currentResults is absent', async () => {
    mount(panel(createFakeVersionHistory(SNAPSHOTS), false));
    await flush();
    expect(buttonByText(/^compare$/i)).toBeNull();
  });
});
