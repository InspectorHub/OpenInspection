// @vitest-environment happy-dom
/**
 * Applying the inspector's signature is an e-sign write. The dialog closes when the signature is handed
 * over, a refusal is reported through `failed`, and a second signature while one is still being applied
 * neither sends a second write nor claims it did.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CommandResult } from '../commands';
import { FieldDataSourceProvider } from '../context';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import type { FakeDataSource } from '../testing/fake-data-source';
import { useInspectorSignature } from './useInspectorSignature';

afterEach(cleanup);

const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

function setup() {
  const fake = createFakeDataSource({ data: createEmptyEditorData() });
  const closed = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FieldDataSourceProvider dataSource={fake}>{children}</FieldDataSourceProvider>
  );
  const hook = renderHook(() => useInspectorSignature('insp-1', closed), { wrapper });
  return { fake, closed, hook };
}

/** Park every write until the test answers it. */
function park(fake: FakeDataSource) {
  const settles: Array<(r: CommandResult<undefined>) => void> = [];
  vi.spyOn(fake, 'execute').mockImplementation((() =>
    new Promise<CommandResult<undefined>>((resolve) => settles.push(resolve))) as FakeDataSource['execute']);
  return settles;
}

describe('useInspectorSignature', () => {
  it('closes the dialog and sends the sign-inspector command with the pad data', async () => {
    const { fake, closed, hook } = setup();
    await act(async () => hook.result.current.submit('data:image/png;base64,AAA'));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(fake.commands).toHaveLength(1);
    expect(fake.commands[0]).toMatchObject({
      inspectionId: 'insp-1',
      cmd: { type: 'sign-inspector', signatureBase64: 'data:image/png;base64,AAA' },
    });
    expect(hook.result.current.failed).toBe(false);
  });

  it('reports a refusal through `failed`, and the next accepted answer clears it', async () => {
    const { fake, hook } = setup();
    fake.failExecute('sign-inspector', 'no');
    await act(async () => hook.result.current.submit('a'));
    expect(hook.result.current.failed).toBe(true);

    vi.spyOn(fake, 'execute').mockResolvedValue({ ok: true } as CommandResult<undefined>);
    await act(async () => hook.result.current.submit('b'));
    expect(hook.result.current.failed).toBe(false);
  });

  it('sends ONE write for two same-frame submits, and does not report the dropped one as a failure', async () => {
    const { fake, hook } = setup();
    const settles = park(fake);
    act(() => {
      void hook.result.current.submit('a');
      void hook.result.current.submit('b');
    });
    expect(settles).toHaveLength(1);
    settles[0]!({ ok: true });
    await flush();
    expect(hook.result.current.failed).toBe(false);
  });

  it('while a signature is being applied a submit sends nothing and does not close the dialog again', async () => {
    const { fake, closed, hook } = setup();
    const settles = park(fake);
    await act(async () => {
      void hook.result.current.submit('a');
    });
    expect(closed).toHaveBeenCalledTimes(1);
    // The hook has re-rendered busy: the repeat is refused before it closes anything.
    await act(async () => hook.result.current.submit('b'));
    expect(settles).toHaveLength(1);
    expect(closed).toHaveBeenCalledTimes(1);
    settles[0]!({ ok: true });
    await flush();
  });

  it('CONTROL - a submit after the first has settled goes through', async () => {
    const { fake, hook } = setup();
    await act(async () => hook.result.current.submit('a'));
    await act(async () => hook.result.current.submit('b'));
    expect(fake.commands).toHaveLength(2);
  });
});
