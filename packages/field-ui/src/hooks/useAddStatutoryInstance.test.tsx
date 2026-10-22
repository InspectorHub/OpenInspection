// @vitest-environment happy-dom
/**
 * Recording one more instance of a repeated block: a second press before the first settles must not write
 * the same panel twice at the same index.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CommandResult } from '../commands';
import { FieldDataSourceProvider } from '../context';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import type { FakeDataSource } from '../testing/fake-data-source';
import { useAddStatutoryInstance } from './useAddStatutoryInstance';

afterEach(cleanup);

function setup() {
  const fake = createFakeDataSource({ data: createEmptyEditorData() });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FieldDataSourceProvider dataSource={fake}>{children}</FieldDataSourceProvider>
  );
  return { fake, hook: renderHook(() => useAddStatutoryInstance('insp-1'), { wrapper }) };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

describe('useAddStatutoryInstance', () => {
  it('sends the add-statutory-instance command for the group, index and fields', async () => {
    const { fake, hook } = setup();
    act(() => hook.result.current.add('owners', 2, { name: 'Sam' }));
    await flush();
    expect(fake.commands).toHaveLength(1);
    expect(fake.commands[0]).toMatchObject({
      inspectionId: 'insp-1',
      cmd: { type: 'add-statutory-instance', groupId: 'owners', index: 2, fields: { name: 'Sam' } },
    });
  });

  it('writes the panel ONCE for two same-frame presses', async () => {
    const { fake, hook } = setup();
    act(() => {
      hook.result.current.add('owners', 2, { name: 'Sam' });
      hook.result.current.add('owners', 2, { name: 'Sam' });
    });
    await flush();
    expect(fake.commands).toHaveLength(1);
  });

  it('is busy while the write is out, and free again when it answers', async () => {
    const { fake, hook } = setup();
    let answer: (r: CommandResult<undefined>) => void = () => undefined;
    vi.spyOn(fake, 'execute').mockImplementation((() =>
      new Promise<CommandResult<undefined>>((resolve) => { answer = resolve; })) as FakeDataSource['execute']);
    act(() => hook.result.current.add('owners', 2, {}));
    expect(hook.result.current.busy).toBe(true);
    answer({ ok: true });
    await flush();
    expect(hook.result.current.busy).toBe(false);
  });

  it('CONTROL - a later press goes through once the first has settled', async () => {
    const { fake, hook } = setup();
    act(() => hook.result.current.add('owners', 2, {}));
    await flush();
    act(() => hook.result.current.add('owners', 3, {}));
    await flush();
    expect(fake.commands.map((c) => (c.cmd as { index: number }).index)).toEqual([2, 3]);
  });
});
