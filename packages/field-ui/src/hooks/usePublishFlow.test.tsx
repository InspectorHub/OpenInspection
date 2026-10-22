// @vitest-environment happy-dom
/**
 * Publish and "Finish fieldwork": the two lifecycle writes. A publish mints a report version, signs it and
 * queues the client notices, so two presses in one frame must reach the host once, and a dropped press must
 * not touch what the first one already changed (status patch, dialog, error).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CommandResult, FieldCommand } from '../commands';
import { FieldDataSourceProvider } from '../context';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import type { FakeDataSource } from '../testing/fake-data-source';
import { usePublishFlow } from './usePublishFlow';

afterEach(cleanup);

const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

/** Every `execute` parks until the test answers it. */
function setup(confirmHuman?: () => Promise<boolean>) {
  const fake = createFakeDataSource({ data: createEmptyEditorData() });
  const pending: Array<(r: CommandResult<undefined>) => void> = [];
  const cmds: FieldCommand[] = [];
  vi.spyOn(fake, 'execute').mockImplementation(((_id: string, cmd: FieldCommand) => {
    cmds.push(cmd);
    return new Promise<CommandResult<undefined>>((resolve) => pending.push(resolve));
  }) as FakeDataSource['execute']);
  const calls = { markedComplete: 0, published: 0, finished: 0 };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FieldDataSourceProvider dataSource={fake}>{children}</FieldDataSourceProvider>
  );
  const hook = renderHook(
    () =>
      usePublishFlow('insp-1', {
        confirmHuman,
        onMarkedComplete: () => { calls.markedComplete += 1; },
        onPublished: () => { calls.published += 1; },
        onFieldworkFinished: () => { calls.finished += 1; },
      }),
    { wrapper },
  );
  return { fake, hook, calls, cmds, answer: (i: number, r: CommandResult<undefined>) => pending[i]?.(r), sent: () => pending.length };
}

describe('usePublishFlow.publish', () => {
  it('sends ONE publish for two same-frame calls, and the repeat changes nothing', async () => {
    const { hook, calls, answer, sent } = setup();
    act(() => {
      void hook.result.current.publish(true, {}, true);
      void hook.result.current.publish(true, {}, true);
    });
    await flush();
    expect(sent()).toBe(1);
    // The status patch is made once: a dropped repeat must not redo what the first call already did.
    expect(calls.markedComplete).toBe(1);
    expect(calls.published).toBe(0);
    answer(0, { ok: true });
    await flush();
    expect(calls.published).toBe(1);
    expect(hook.result.current.publishError).toBeNull();
  });

  it('CONTROL - a later press goes through once the first has settled', async () => {
    const { hook, calls, answer, sent } = setup();
    act(() => { void hook.result.current.publish(false, {}, false); });
    await flush();
    answer(0, { ok: true });
    await flush();
    act(() => { void hook.result.current.publish(false, {}, false); });
    await flush();
    expect(sent()).toBe(2);
    expect(calls.markedComplete).toBe(0);
  });

  it('carries the flag, the revision reason and mark-complete only when they were asked for', async () => {
    const { hook, cmds, answer } = setup();
    act(() => { void hook.result.current.publish(true, { summary: 'Fixed the roof rating' }, true); });
    await flush();
    answer(0, { ok: true });
    await flush();
    act(() => { void hook.result.current.publish(false, {}, false); });
    await flush();
    expect(cmds[0]).toEqual({ type: 'publish', autoSignOnPublish: true, markComplete: true, summary: 'Fixed the roof rating' });
    expect(cmds[1]).toEqual({ type: 'publish', autoSignOnPublish: false });
  });

  it('on success: closes the dialog, reloads the editor data once, and shows no error', async () => {
    const { fake, hook, calls, answer } = setup();
    act(() => { void hook.result.current.publish(false, {}, false); });
    await flush();
    answer(0, { ok: true });
    await flush();
    expect(calls.published).toBe(1);
    expect(fake.reloadCount).toBe(1);
    expect(hook.result.current.publishing).toBe(false);
  });

  it('on a refusal: keeps the dialog open, shows the server reason, and does not reload', async () => {
    const { fake, hook, calls, answer } = setup();
    act(() => { void hook.result.current.publish(false, {}, false); });
    await flush();
    answer(0, { ok: false, error: 'Not completed' });
    await flush();
    expect(hook.result.current.publishError).toBe('Not completed');
    expect(calls.published).toBe(0);
    expect(fake.reloadCount).toBe(0);
  });

  it('falls back to a generic sentence when the refusal carries none, and clears it on request', async () => {
    const { hook, answer } = setup();
    act(() => { void hook.result.current.publish(false, {}, false); });
    await flush();
    answer(0, { ok: false });
    await flush();
    expect(hook.result.current.publishError).toMatch(/couldn.t publish/i);
    act(() => hook.result.current.clearPublishError());
    expect(hook.result.current.publishError).toBeNull();
  });

  it('a dropped repeat of a retry leaves the standing outcome to the first request', async () => {
    const { fake, hook, calls, answer } = setup();
    act(() => { void hook.result.current.publish(false, {}, false); });
    await flush();
    answer(0, { ok: false, error: 'Not completed' });
    await flush();
    // Retry: the first press is in flight, then a same-frame repeat arrives.
    act(() => {
      void hook.result.current.publish(false, {}, false);
      void hook.result.current.publish(false, {}, false);
    });
    await flush();
    expect(fake.reloadCount).toBe(0);
    expect(calls.published).toBe(0);
    answer(1, { ok: false, error: 'Still not completed' });
    await flush();
    expect(hook.result.current.publishError).toBe('Still not completed');
  });

  it('does not ask for a second human check while a publish is already in flight', async () => {
    const confirmHuman = vi.fn(() => Promise.resolve(true));
    const { hook, sent } = setup(confirmHuman);
    act(() => { void hook.result.current.publish(false, {}, false); });
    await flush();
    expect(sent()).toBe(1);
    // Later than the same frame: the first request is out, so a second press must not prompt again.
    act(() => { void hook.result.current.publish(false, {}, false); });
    await flush();
    expect(confirmHuman).toHaveBeenCalledTimes(1);
    expect(sent()).toBe(1);
  });

  it('sends nothing when the human check is declined', async () => {
    const { hook, calls, sent } = setup(() => Promise.resolve(false));
    act(() => { void hook.result.current.publish(true, {}, false); });
    await flush();
    expect(sent()).toBe(0);
    expect(calls.markedComplete).toBe(0);
  });
});

describe('usePublishFlow.finishFieldwork', () => {
  it('sends ONE complete for two same-frame calls', async () => {
    const { fake, hook, calls, answer, sent } = setup();
    act(() => {
      void hook.result.current.finishFieldwork();
      void hook.result.current.finishFieldwork();
    });
    await flush();
    expect(sent()).toBe(1);
    expect(hook.result.current.finishing).toBe(true);
    answer(0, { ok: true });
    await flush();
    // One status patch and one reload: the dropped repeat adds neither.
    expect(calls.finished).toBe(1);
    expect(fake.reloadCount).toBe(1);
    expect(hook.result.current.finishing).toBe(false);
  });

  it('CONTROL - a later press goes through once the first has settled', async () => {
    const { hook, answer, sent } = setup();
    act(() => { void hook.result.current.finishFieldwork(); });
    await flush();
    answer(0, { ok: true });
    await flush();
    act(() => { void hook.result.current.finishFieldwork(); });
    await flush();
    expect(sent()).toBe(2);
  });

  it('reloads on success, and reports a refusal through finishError until the next attempt starts', async () => {
    const { fake, hook, calls, answer } = setup();
    act(() => { void hook.result.current.finishFieldwork(); });
    await flush();
    answer(0, { ok: false, error: 'No' });
    await flush();
    expect(calls.finished).toBe(0);
    expect(fake.reloadCount).toBe(0);
    expect(hook.result.current.finishError).toBe('No');
    act(() => { void hook.result.current.finishFieldwork(); });
    await flush();
    expect(hook.result.current.finishError).toBeNull();
    answer(1, { ok: true });
    await flush();
    expect(calls.finished).toBe(1);
    expect(fake.reloadCount).toBe(1);
    expect(hook.result.current.finishError).toBeNull();
  });

  it('falls back to the catalogue sentence when the refusal carries no reason', async () => {
    const { hook, answer } = setup();
    act(() => { void hook.result.current.finishFieldwork(); });
    await flush();
    answer(0, { ok: false });
    await flush();
    expect(hook.result.current.finishError).toMatch(/could not mark fieldwork complete/i);
  });

  it('a dropped repeat of a retry reports no error of its own', async () => {
    const { hook, answer } = setup();
    act(() => { void hook.result.current.finishFieldwork(); });
    await flush();
    answer(0, { ok: false, error: 'No' });
    await flush();
    act(() => {
      void hook.result.current.finishFieldwork();
      void hook.result.current.finishFieldwork();
    });
    await flush();
    // The retry is in flight; the repeat was dropped without producing an error of its own.
    answer(1, { ok: true });
    await flush();
    expect(hook.result.current.finishError).toBeNull();
  });

  it('does not share a guard with publish: a finish is not dropped by an in-flight publish', async () => {
    const { hook, sent } = setup();
    act(() => {
      void hook.result.current.publish(false, {}, false);
      void hook.result.current.finishFieldwork();
    });
    await flush();
    expect(sent()).toBe(2);
  });
});
