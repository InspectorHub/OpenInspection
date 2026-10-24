// @vitest-environment happy-dom
/**
 * The structure-edit write paths on the provider and a data source whose `execute` the test parks:
 * chained edits compose on the optimistic snapshot and the newest one wins on the wire, and saving to a
 * template is its own write that neither cancels nor waits for a restructure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CommandResult, FieldCommand } from '../commands';
import { FieldDataSourceProvider } from '../context';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import type { FakeDataSource } from '../testing/fake-data-source';
import { useStructureEdit } from './useStructureEdit';

afterEach(cleanup);

const raw = {
  schemaVersion: 2 as const,
  sections: [
    { id: 's1', title: 'One', items: [] },
    { id: 's2', title: 'Two', items: [] },
  ],
};

function setup(over: { collabEditing?: boolean; templateId?: string | null } = {}) {
  const fake = createFakeDataSource({ data: createEmptyEditorData() });
  const calls: Array<{ cmd: FieldCommand; settle: (r: CommandResult<undefined>) => void }> = [];
  vi.spyOn(fake, 'execute').mockImplementation(((_id: string, cmd: FieldCommand) =>
    new Promise<CommandResult<undefined>>((resolve) => calls.push({ cmd, settle: resolve }))) as FakeDataSource['execute']);
  const applied: string[][] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FieldDataSourceProvider dataSource={fake}>{children}</FieldDataSourceProvider>
  );
  const hook = renderHook(
    () =>
      useStructureEdit({
        inspectionId: 'insp-1',
        rawSnapshot: raw,
        collabEditing: over.collabEditing ?? false,
        results: {},
        templateId: over.templateId ?? null,
        onApply: (next) => applied.push(next.sections.map((s) => s.title)),
      }),
    { wrapper },
  );
  return { calls, applied, hook };
}

const titles = (cmd: FieldCommand | undefined) =>
  cmd?.type === 'restructure' ? cmd.snapshot.sections.map((s) => s.title) : undefined;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

describe('useStructureEdit write paths', () => {
  it('chained edits compose on the optimistic snapshot; the wire carries the first, then only the newest', async () => {
    const { calls, applied, hook } = setup({ collabEditing: true });
    act(() => {
      hook.result.current.renameSection('s1', 'A');
      hook.result.current.renameSection('s2', 'B');
      hook.result.current.renameSection('s1', 'C');
    });
    // The display refresh saw every step, each on top of the previous one.
    expect(applied).toEqual([['A', 'Two'], ['A', 'B'], ['C', 'B']]);
    expect(calls.map((c) => titles(c.cmd))).toEqual([['A', 'Two']]);
    expect(calls[0]!.cmd).toMatchObject({ type: 'restructure', collab: true });
    calls[0]!.settle({ ok: true });
    await flush();
    expect(calls.map((c) => titles(c.cmd))).toEqual([['A', 'Two'], ['C', 'B']]);
    calls[1]!.settle({ ok: true });
    await flush();
    // The last write on the wire is the last snapshot.
    expect(titles(calls[calls.length - 1]!.cmd)).toEqual(['C', 'B']);
  });

  it('a failure of the first restructure does not lose the next one', async () => {
    const { calls, hook } = setup();
    act(() => {
      hook.result.current.renameSection('s1', 'A');
      hook.result.current.renameSection('s2', 'B');
    });
    calls[0]!.settle({ ok: false, error: 'boom' });
    await flush();
    expect(calls.map((c) => titles(c.cmd))).toEqual([['A', 'Two'], ['A', 'B']]);
  });

  it('save to a new template sends the current snapshot and a name', async () => {
    const { calls, hook } = setup();
    act(() => hook.result.current.renameSection('s1', 'A'));
    act(() => hook.result.current.openSaveTemplate('new'));
    act(() => hook.result.current.setSaveTemplateName('  Mine  '));
    act(() => hook.result.current.submitSaveTemplate());
    const save = calls.find((c) => c.cmd.type === 'save-structure-template');
    expect(save?.cmd).toMatchObject({ type: 'save-structure-template', mode: 'new', name: 'Mine' });
    expect(hook.result.current.saveTemplatePending).toBeNull();
    expect(save?.cmd.type === 'save-structure-template' && save.cmd.snapshot.sections[0]?.title).toBe('A');
  });

  it('save back to the source template carries the template id', () => {
    const { calls, hook } = setup({ templateId: 'tpl-9' });
    expect(hook.result.current.canSaveBack).toBe(true);
    act(() => hook.result.current.openSaveTemplate('back'));
    act(() => hook.result.current.submitSaveTemplate());
    expect(calls[0]!.cmd).toMatchObject({ type: 'save-structure-template', mode: 'back', templateId: 'tpl-9' });
  });

  it('saving while a restructure is in flight neither cancels nor waits for it', async () => {
    const { calls, hook } = setup({ templateId: 'tpl-9' });
    act(() => hook.result.current.renameSection('s1', 'A'));
    act(() => hook.result.current.openSaveTemplate('back'));
    act(() => hook.result.current.submitSaveTemplate());
    // Both writes are on the wire at once.
    expect(calls.map((c) => c.cmd.type)).toEqual(['restructure', 'save-structure-template']);
    calls[1]!.settle({ ok: true });
    calls[0]!.settle({ ok: true });
    await flush();
    expect(calls).toHaveLength(2);
  });

  it('a restructure after a save is sent (the save does not hold the channel)', async () => {
    const { calls, hook } = setup({ templateId: 'tpl-9' });
    act(() => hook.result.current.openSaveTemplate('back'));
    act(() => hook.result.current.submitSaveTemplate());
    act(() => hook.result.current.renameSection('s1', 'A'));
    expect(calls.map((c) => c.cmd.type)).toEqual(['save-structure-template', 'restructure']);
  });
});

describe('useStructureEdit refused restructure', () => {
  const messages = () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    const seen: Array<{ message: string; variant: string | undefined }> = [];
    vi.spyOn(fake, 'notify').mockImplementation((message, variant) => { seen.push({ message, variant }); });
    return { fake, seen };
  };
  const mountWith = (fake: FakeDataSource, answers: Array<CommandResult<undefined>>) => {
    vi.spyOn(fake, 'execute').mockImplementation((async () => answers.shift() ?? { ok: true }) as FakeDataSource['execute']);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FieldDataSourceProvider dataSource={fake}>{children}</FieldDataSourceProvider>
    );
    return renderHook(
      () => useStructureEdit({ inspectionId: 'insp-1', rawSnapshot: raw, collabEditing: true, results: {} }),
      { wrapper },
    );
  };

  it("shows the host's own sentence when a restructure is refused", async () => {
    const { fake, seen } = messages();
    const hook = mountWith(fake, [{ ok: false, error: 'Structure saved, but live sync did not converge. Reload to continue editing.' }]);
    act(() => hook.result.current.renameSection('s1', 'A'));
    await flush();
    expect(seen).toEqual([{ message: 'Structure saved, but live sync did not converge. Reload to continue editing.', variant: 'error' }]);
  });

  it('says something generic when the refusal carries no sentence, and nothing when it succeeds', async () => {
    const { fake, seen } = messages();
    const hook = mountWith(fake, [{ ok: false }, { ok: true }]);
    act(() => hook.result.current.renameSection('s1', 'A'));
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.message).toMatch(/structure/i);
    act(() => hook.result.current.renameSection('s1', 'B'));
    await flush();
    expect(seen).toHaveLength(1);
  });

  it('a refusal that a newer edit superseded is not reported; the newest edit answers', async () => {
    const { fake, seen } = messages();
    const calls: Array<(r: CommandResult<undefined>) => void> = [];
    vi.spyOn(fake, 'execute').mockImplementation(((_i: string, _c: FieldCommand) =>
      new Promise<CommandResult<undefined>>((resolve) => calls.push(resolve))) as FakeDataSource['execute']);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FieldDataSourceProvider dataSource={fake}>{children}</FieldDataSourceProvider>
    );
    const hook = renderHook(
      () => useStructureEdit({ inspectionId: 'insp-1', rawSnapshot: raw, collabEditing: true, results: {} }),
      { wrapper },
    );
    act(() => {
      hook.result.current.renameSection('s1', 'A');
      hook.result.current.renameSection('s2', 'B');
    });
    calls[0]!({ ok: false, error: 'first failed' });
    await flush();
    expect(seen).toEqual([]);
    calls[1]!({ ok: false, error: 'newest failed' });
    await flush();
    expect(seen.map((s) => s.message)).toEqual(['newest failed']);
  });
});
