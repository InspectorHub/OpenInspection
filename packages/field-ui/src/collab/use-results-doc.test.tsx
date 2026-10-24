// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { FieldDataSourceProvider } from '../context';
import type { CollabConnector, FieldDataSource, ResultsDocHandle as LiveHandle } from '../data-source';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import { useResultsDoc } from './use-results-doc';
import type { ResultsDocHandle } from './use-results-doc';

afterEach(cleanup);

/** A connector the test drives by hand: it records connects and hands back the callbacks. */
function manualConnector() {
  const connects: Array<{ id: string; onChange?: () => void; onSynced?: () => void; live: LiveHandle; destroyed: boolean; setSynced(v: boolean): void; resolvePersisted(): void }> = [];
  const connector: CollabConnector = {
    connect(id, opts) {
      let synced = false;
      let resolvePersisted: () => void = () => undefined;
      const persistenceSynced = new Promise<void>((r) => {
        resolvePersisted = r;
      });
      const rec = {
        id,
        onChange: opts.onChange,
        onSynced: opts.onSynced,
        destroyed: false,
        setSynced: (v: boolean) => {
          synced = v;
        },
        resolvePersisted,
        live: undefined as unknown as LiveHandle,
      };
      rec.live = {
        doc: new Y.Doc(),
        persistenceSynced,
        synced: () => synced,
        destroy: () => {
          rec.destroyed = true;
        },
      };
      connects.push(rec);
      return rec.live;
    },
    purge: async () => undefined,
  };
  return { connector, connects };
}

let seen: ResultsDocHandle | null = null;
function Harness({ id, onSynced }: { id: string | null; onSynced?: () => void }) {
  seen = useResultsDoc(id, onSynced);
  return null;
}
function mount(ds: FieldDataSource, ui: React.ReactElement) {
  return render(<FieldDataSourceProvider dataSource={ds}>{ui}</FieldDataSourceProvider>);
}
function sourceWith(connector: CollabConnector): FieldDataSource {
  return { ...createFakeDataSource({ data: createEmptyEditorData() }), collab: connector };
}

describe('useResultsDoc', () => {
  it('connects through the data source and exposes the initial handle at once', () => {
    const { connector, connects } = manualConnector();
    mount(sourceWith(connector), <Harness id="insp-1" />);
    expect(connects.map((c) => c.id)).toEqual(['insp-1']);
    expect(seen).toMatchObject({ persistenceSynced: false, synced: false });
    expect(seen?.doc).toBe(connects[0].live.doc);
  });

  it('republishes a NEW handle object when the connection changes, with the live synced flag and document', async () => {
    const { connector, connects } = manualConnector();
    mount(sourceWith(connector), <Harness id="insp-1" />);
    const first = seen;
    connects[0].setSynced(true);
    act(() => connects[0].onChange?.());
    expect(seen).not.toBe(first);
    expect(seen).toMatchObject({ synced: true });
    // A version restore swaps the document; the next change publishes the new one.
    const fresh = new Y.Doc();
    (connects[0].live as { doc: Y.Doc }).doc = fresh;
    act(() => connects[0].onChange?.());
    expect(seen?.doc).toBe(fresh);
  });

  it('flags persistenceSynced once the store has applied its state', async () => {
    const { connector, connects } = manualConnector();
    mount(sourceWith(connector), <Harness id="insp-1" />);
    expect(seen?.persistenceSynced).toBe(false);
    await act(async () => {
      connects[0].resolvePersisted();
      await Promise.resolve();
    });
    expect(seen?.persistenceSynced).toBe(true);
  });

  it('calls the LATEST onSynced without reconnecting when its identity changes', () => {
    const { connector, connects } = manualConnector();
    const first = vi.fn();
    const second = vi.fn();
    const ds = sourceWith(connector);
    const view = mount(ds, <Harness id="insp-1" onSynced={first} />);
    view.rerender(
      <FieldDataSourceProvider dataSource={ds}>
        <Harness id="insp-1" onSynced={second} />
      </FieldDataSourceProvider>,
    );
    expect(connects).toHaveLength(1);
    connects[0].onSynced?.();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('destroys the connection on unmount and reconnects for another inspection', () => {
    const { connector, connects } = manualConnector();
    const ds = sourceWith(connector);
    const view = mount(ds, <Harness id="insp-1" />);
    view.rerender(
      <FieldDataSourceProvider dataSource={ds}>
        <Harness id="insp-2" />
      </FieldDataSourceProvider>,
    );
    expect(connects.map((c) => [c.id, c.destroyed])).toEqual([['insp-1', true], ['insp-2', false]]);
    view.unmount();
    expect(connects[1].destroyed).toBe(true);
  });

  it('does not connect without an inspection id, and yields no handle', () => {
    const { connector, connects } = manualConnector();
    mount(sourceWith(connector), <Harness id={null} />);
    expect(connects).toHaveLength(0);
    expect(seen).toBeNull();
  });

  it('ignores a change that arrives after unmount', () => {
    const { connector, connects } = manualConnector();
    const view = mount(sourceWith(connector), <Harness id="insp-1" />);
    view.unmount();
    expect(() => act(() => connects[0].onChange?.())).not.toThrow();
  });
});
