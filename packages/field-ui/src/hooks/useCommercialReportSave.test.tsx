// @vitest-environment happy-dom
/**
 * The commercial subtype and report-tier selectors. Each local (optimistic) update must be made only when its
 * write was accepted, and the two selectors must not swallow each other.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CommandResult, FieldCommand } from '../commands';
import { FieldDataSourceProvider } from '../context';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import type { FakeDataSource } from '../testing/fake-data-source';
import { useCommercialReportSave } from './useCommercialReportSave';

afterEach(cleanup);

const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

function setup() {
  const fake = createFakeDataSource({ data: createEmptyEditorData() });
  const pending: Array<(r: CommandResult<undefined>) => void> = [];
  const cmds: FieldCommand[] = [];
  vi.spyOn(fake, 'execute').mockImplementation(((_id: string, cmd: FieldCommand) => {
    cmds.push(cmd);
    return new Promise<CommandResult<undefined>>((resolve) => pending.push(resolve));
  }) as FakeDataSource['execute']);
  const patches: unknown[] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FieldDataSourceProvider dataSource={fake}>{children}</FieldDataSourceProvider>
  );
  const hook = renderHook(() => useCommercialReportSave('insp-1', (p) => patches.push(p)), { wrapper });
  return { hook, cmds, patches, answer: (i: number, r: CommandResult<undefined>) => pending[i]?.(r) };
}

describe('useCommercialReportSave', () => {
  it('sends ONE write and makes ONE local update for two same-frame subtype changes', async () => {
    const { hook, cmds, patches } = setup();
    act(() => {
      hook.result.current.changeSubtype('office');
      hook.result.current.changeSubtype('retail');
    });
    await flush();
    expect(cmds).toEqual([{ type: 'save-property-facts', payload: { commercialSubtype: 'office' } }]);
    // The dropped second change must not move the screen to a value the server never got.
    expect(patches).toEqual([{ commercialSubtype: 'office' }]);
    expect(hook.result.current.saving).toBe(true);
  });

  it('sends ONE write for two same-frame tier changes', async () => {
    const { hook, cmds, patches } = setup();
    act(() => {
      hook.result.current.changeTier('full_pca');
      hook.result.current.changeTier('light_commercial');
    });
    await flush();
    expect(cmds).toEqual([{ type: 'save-property-facts', payload: { reportTier: 'full_pca' } }]);
    expect(patches).toEqual([{ reportTier: 'full_pca' }]);
  });

  it('CONTROL - a later change goes through once the first has settled', async () => {
    const { hook, cmds, patches, answer } = setup();
    act(() => hook.result.current.changeSubtype('office'));
    await flush();
    answer(0, { ok: true });
    await flush();
    expect(hook.result.current.saving).toBe(false);
    act(() => hook.result.current.changeSubtype('retail'));
    await flush();
    expect(cmds).toHaveLength(2);
    expect(patches).toEqual([{ commercialSubtype: 'office' }, { commercialSubtype: 'retail' }]);
  });

  it('a tier change is not swallowed by an in-flight subtype save', async () => {
    const { hook, cmds, patches } = setup();
    act(() => {
      hook.result.current.changeSubtype('office');
      hook.result.current.changeTier('full_pca');
    });
    await flush();
    expect(cmds).toHaveLength(2);
    expect(patches).toEqual([{ commercialSubtype: 'office' }, { reportTier: 'full_pca' }]);
  });

  it('keeps the local value when the server refuses, as the fetcher version did', async () => {
    const { hook, patches, answer } = setup();
    act(() => hook.result.current.changeSubtype('office'));
    await flush();
    answer(0, { ok: false, error: 'No' });
    await flush();
    expect(patches).toEqual([{ commercialSubtype: 'office' }]);
    expect(hook.result.current.saving).toBe(false);
  });
});
