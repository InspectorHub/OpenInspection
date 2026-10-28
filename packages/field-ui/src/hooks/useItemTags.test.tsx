// @vitest-environment happy-dom
/**
 * The tags an inspector puts on a checklist item must survive a reload.
 *
 * The chip rows and the picker used to change in-memory state only: nothing was sent and nothing was read back, so
 * a reload (or a second device) showed every item untagged. The hook talks to `FieldDataSource.resources.itemTags`
 * only; the web host serves that from `/resources/inspection-item-tags` (see app/lib/field/web-item-tags.test.ts).
 *
 * One probe is rendered and its latest answer read, because the rollback of a failed write has to be seen across
 * updates of the SAME hook instance. The data source's answers are driven by hand where timing matters.
 */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { CommandResult } from '../commands';
import { FieldDataSourceProvider } from '../context';
import type { FieldResources } from '../data-source';
import type { ItemTagMap } from '../data-source-types';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import { useItemTags } from './useItemTags';

afterEach(cleanup);

const URGENT = { id: 'tag-urgent', name: 'Urgent', color: '#f97316' };
const FOLLOW = { id: 'tag-follow', name: 'Follow Up', color: '#ef4444' };

type Store = NonNullable<FieldResources['itemTags']>;

function harness(itemTags: Store | undefined, initial: ItemTagMap = {}) {
  const notify = vi.fn();
  const ds = createFakeDataSource({ data: createEmptyEditorData(), resources: itemTags ? { itemTags } : {} });
  ds.notify = notify;
  let state: ItemTagMap = initial;
  let toggle!: ReturnType<typeof useItemTags>['toggle'];
  function Probe() {
    const [tagsByItem, setTagsByItem] = useState<ItemTagMap>(initial);
    state = tagsByItem;
    toggle = useItemTags('insp-1', setTagsByItem).toggle;
    return null;
  }
  render(
    <FieldDataSourceProvider dataSource={ds}>
      <Probe />
    </FieldDataSourceProvider>,
  );
  return { state: () => state, toggle: (item: string, tag: typeof URGENT) => toggle(item, tag, state[item] ?? []), notify };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

const ok: CommandResult = { ok: true };

function store(over: Partial<Store> = {}): Store & { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
  return {
    list: vi.fn(async () => ({}) as ItemTagMap),
    add: vi.fn(async () => ok),
    remove: vi.fn(async () => ok),
    ...over,
  } as Store & { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
}

describe('useItemTags — reading what was saved', () => {
  it('shows the tags the host has stored for each item once the editor opens', async () => {
    const saved: ItemTagMap = { 'item-a': [URGENT], 'item-b': [URGENT, FOLLOW] };
    const h = harness(store({ list: vi.fn(async () => saved) }));
    await flush();
    expect(h.state()).toEqual(saved);
  });

  it('asks for the right inspection, once', async () => {
    const s = store();
    harness(s);
    await flush();
    expect(s.list).toHaveBeenCalledTimes(1);
    expect(s.list).toHaveBeenCalledWith('insp-1');
  });

  it('keeps what it already shows when the host could not answer, and when the read throws', async () => {
    const withNull = harness(store({ list: vi.fn(async () => null) }), { 'item-a': [FOLLOW] });
    await flush();
    expect(withNull.state()).toEqual({ 'item-a': [FOLLOW] });
    cleanup();

    const withThrow = harness(store({ list: vi.fn(async () => { throw new Error('offline'); }) }), { 'item-a': [FOLLOW] });
    await flush();
    expect(withThrow.state()).toEqual({ 'item-a': [FOLLOW] });
  });

  it('lets an item the inspector already touched win over the stored answer that arrives late', async () => {
    let settle!: (m: ItemTagMap) => void;
    const h = harness(store({ list: () => new Promise<ItemTagMap>((r) => { settle = r; }) }));
    h.toggle('item-a', URGENT);
    await act(async () => { settle({ 'item-a': [FOLLOW], 'item-b': [FOLLOW] }); });
    await flush();
    expect(h.state()['item-a']).toEqual([URGENT]);
    expect(h.state()['item-b']).toEqual([FOLLOW]);
  });
});

describe('useItemTags — saving a toggle', () => {
  it('attaches a tag that is not on the item, and shows it at once', async () => {
    const s = store();
    const h = harness(s);
    await flush();
    act(() => h.toggle('item-a', URGENT));
    expect(h.state()['item-a']).toEqual([URGENT]);
    await flush();
    expect(s.add).toHaveBeenCalledWith('insp-1', 'item-a', 'tag-urgent');
    expect(s.remove).not.toHaveBeenCalled();
  });

  it('detaches a tag that is on the item', async () => {
    const s = store();
    const h = harness(s, { 'item-a': [URGENT, FOLLOW] });
    await flush();
    act(() => h.toggle('item-a', URGENT));
    expect(h.state()['item-a']).toEqual([FOLLOW]);
    await flush();
    expect(s.remove).toHaveBeenCalledWith('insp-1', 'item-a', 'tag-urgent');
    expect(s.add).not.toHaveBeenCalled();
  });

  it('takes an attach back and says so when the host did not store it', async () => {
    const h = harness(store({ add: vi.fn(async () => ({ ok: false, error: 'no' }) as CommandResult) }));
    await flush();
    h.toggle('item-a', URGENT);
    await flush();
    expect(h.state()['item-a'] ?? []).toEqual([]);
    expect(h.notify).toHaveBeenCalledWith(expect.stringMatching(/did NOT reach the server/), 'error', expect.anything());
  });

  it('puts a detached tag back when the host did not store the removal, even when the call throws', async () => {
    const h = harness(store({ remove: vi.fn(async () => { throw new Error('offline'); }) }), { 'item-a': [URGENT] });
    await flush();
    h.toggle('item-a', URGENT);
    await flush();
    expect(h.state()['item-a']).toEqual([URGENT]);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('sends one request for a repeat of the same toggle in the same frame, and still sends a different tag', async () => {
    let settle!: (r: CommandResult) => void;
    const s = store({ add: vi.fn(() => new Promise<CommandResult>((r) => { settle = r; })) });
    const h = harness(s);
    await flush();
    act(() => {
      h.toggle('item-a', URGENT);
      h.toggle('item-a', URGENT); // a second press before the first answer
      h.toggle('item-a', FOLLOW); // the control: another tag is not held up by the first
    });
    expect(s.add).toHaveBeenCalledTimes(2);
    expect(s.add.mock.calls.map((c) => c[2]).sort()).toEqual(['tag-follow', 'tag-urgent']);
    await act(async () => { settle(ok); });
  });

  it('lets the same tag be toggled again once the first answer is in', async () => {
    const s = store();
    const h = harness(s);
    await flush();
    h.toggle('item-a', URGENT);
    await flush();
    h.toggle('item-a', URGENT);
    await flush();
    expect(s.add).toHaveBeenCalledTimes(1);
    expect(s.remove).toHaveBeenCalledTimes(1);
  });
});

describe('useItemTags — a host with no store', () => {
  it('still changes the chips in memory and sends nothing, as the editor always did', async () => {
    const h = harness(undefined);
    await flush();
    act(() => h.toggle('item-a', URGENT));
    expect(h.state()['item-a']).toEqual([URGENT]);
    act(() => h.toggle('item-a', URGENT)); // a later press, after the page has rendered the first
    expect(h.state()['item-a'] ?? []).toEqual([]);
    expect(h.notify).not.toHaveBeenCalled();
  });
});
