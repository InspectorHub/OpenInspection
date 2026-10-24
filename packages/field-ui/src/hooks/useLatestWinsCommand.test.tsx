// @vitest-environment happy-dom
/**
 * The latest-wins write channel. A restructure replaces the whole template snapshot, so the NEWEST
 * snapshot must end up on the server and every older one may be skipped, but none may be dropped in
 * favour of an older one (that is what `useFieldCommand`'s overlap rule would do).
 *
 * `execute` is parked by the test, so "in flight" is something the test controls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { CommandResult, FieldCommand } from '../commands';
import { FieldDataSourceProvider, isIgnored } from '../context';
import type { FieldRunResult } from '../context';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import type { FakeDataSource } from '../testing/fake-data-source';
import { useLatestWinsCommand } from './useLatestWinsCommand';
import type { LatestWinsRunner } from './useLatestWinsCommand';

afterEach(cleanup);

const snap = (n: number) => ({ schemaVersion: 2 as const, sections: [{ id: `s${n}`, title: `T${n}`, items: [] }] });
const restructure = (n: number): FieldCommand => ({ type: 'restructure', snapshot: snap(n), collab: false });
const titleOf = (cmd: FieldCommand | undefined) =>
  cmd?.type === 'restructure' ? String(cmd.snapshot.sections[0]?.title) : undefined;

function setup() {
  const fake = createFakeDataSource({ data: createEmptyEditorData() });
  /** The commands `execute` received, with the function that settles each. */
  const calls: Array<{ cmd: FieldCommand; settle: (r: CommandResult<undefined>) => void }> = [];
  vi.spyOn(fake, 'execute').mockImplementation(((_id: string, cmd: FieldCommand) =>
    new Promise<CommandResult<undefined>>((resolve) => calls.push({ cmd, settle: resolve }))) as FakeDataSource['execute']);
  let runner: LatestWinsRunner | null = null;
  function Probe() {
    runner = useLatestWinsCommand('insp-1');
    return null;
  }
  const view = render(
    <FieldDataSourceProvider dataSource={fake}>
      <Probe />
    </FieldDataSourceProvider>,
  );
  const submit = (cmd: FieldCommand) => runner!.submit(cmd);
  return { calls, submit, busy: () => runner!.busy, unmount: view.unmount };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

/** Submit and record how the promise settled. */
function track(p: Promise<FieldRunResult<unknown>>) {
  const box: { result?: FieldRunResult<unknown> } = {};
  void p.then((r) => {
    box.result = r;
  });
  return box;
}

describe('useLatestWinsCommand', () => {
  it('a burst of edits sends the one in flight plus only the newest; the last snapshot is the final state', async () => {
    const { calls, submit } = setup();
    const answers = [1, 2, 3, 4, 5].map((n) => {
      let box!: ReturnType<typeof track>;
      act(() => {
        box = track(submit(restructure(n)));
      });
      return box;
    });
    // One request is on the wire; 2..4 were replaced in the queue.
    expect(calls.map((c) => titleOf(c.cmd))).toEqual(['T1']);
    calls[0]!.settle({ ok: true });
    await flush();
    expect(calls.map((c) => titleOf(c.cmd))).toEqual(['T1', 'T5']);
    calls[1]!.settle({ ok: true });
    await flush();
    // Nothing else was sent: the server's last write is the newest snapshot.
    expect(calls).toHaveLength(2);
    expect(titleOf(calls[calls.length - 1]!.cmd)).toBe('T5');
    // Only the newest request reports a real answer; the rest read as ignored.
    expect(answers.slice(0, 4).every((a) => a.result !== undefined && isIgnored(a.result))).toBe(true);
    expect(answers[4]!.result).toEqual({ ok: true });
  });

  it('ignores the settled answer of a request a newer one superseded', async () => {
    const { calls, submit } = setup();
    let first!: ReturnType<typeof track>;
    act(() => {
      first = track(submit(restructure(1)));
    });
    act(() => {
      void submit(restructure(2));
    });
    calls[0]!.settle({ ok: false, error: 'late failure of the old snapshot' });
    await flush();
    // Not reported as a failure: the answer of a superseded request is discarded.
    expect(first.result && isIgnored(first.result)).toBe(true);
  });

  it('keeps the queued newer request when the one in flight fails', async () => {
    const { calls, submit } = setup();
    let first!: ReturnType<typeof track>;
    let second!: ReturnType<typeof track>;
    act(() => {
      first = track(submit(restructure(1)));
      second = track(submit(restructure(2)));
    });
    calls[0]!.settle({ ok: false, error: 'boom' });
    await flush();
    expect(calls.map((c) => titleOf(c.cmd))).toEqual(['T1', 'T2']);
    calls[1]!.settle({ ok: true });
    await flush();
    expect(second.result).toEqual({ ok: true });
    expect(first.result && isIgnored(first.result)).toBe(true);
  });

  it('reports the failure of the newest request, and a later request still goes through', async () => {
    const { calls, submit, busy } = setup();
    let only!: ReturnType<typeof track>;
    act(() => {
      only = track(submit(restructure(1)));
    });
    expect(busy()).toBe(true);
    calls[0]!.settle({ ok: false, error: 'boom' });
    await flush();
    expect(only.result).toEqual({ ok: false, error: 'boom' });
    expect(busy()).toBe(false);
    act(() => {
      void submit(restructure(2));
    });
    expect(calls.map((c) => titleOf(c.cmd))).toEqual(['T1', 'T2']);
  });

  it('sends ONE request for two triggers of the same snapshot in one frame', async () => {
    const { calls, submit } = setup();
    let a!: ReturnType<typeof track>;
    let b!: ReturnType<typeof track>;
    act(() => {
      a = track(submit(restructure(1)));
      b = track(submit(restructure(1)));
    });
    expect(calls).toHaveLength(1);
    calls[0]!.settle({ ok: true });
    await flush();
    expect(calls).toHaveLength(1);
    expect(a.result).toEqual({ ok: true });
    expect(b.result).toEqual({ ok: true });
  });

  it('a snapshot equal to the one in flight supersedes a queued different one', async () => {
    const { calls, submit } = setup();
    act(() => {
      void submit(restructure(1));
      void submit(restructure(2));
      void submit(restructure(1));
    });
    calls[0]!.settle({ ok: true });
    await flush();
    // The newest snapshot (1) is the one already sent; 2 must not be written after it.
    expect(calls.map((c) => titleOf(c.cmd))).toEqual(['T1']);
  });

  it('survives an unmount: sets no state, still sends the newest edit', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { calls, submit, unmount } = setup();
    act(() => {
      void submit(restructure(1));
      void submit(restructure(2));
    });
    unmount();
    calls[0]!.settle({ ok: true });
    await flush();
    expect(calls.map((c) => titleOf(c.cmd))).toEqual(['T1', 'T2']);
    calls[1]!.settle({ ok: true });
    await flush();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('never writes a queued snapshot to a different inspection when the id changes while it waits', async () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    const calls: Array<{ id: string; cmd: FieldCommand; settle: (r: CommandResult<undefined>) => void }> = [];
    vi.spyOn(fake, 'execute').mockImplementation(((id: string, cmd: FieldCommand) =>
      new Promise<CommandResult<undefined>>((resolve) => calls.push({ id, cmd, settle: resolve }))) as FakeDataSource['execute']);
    let runner: LatestWinsRunner | null = null;
    function Probe({ id }: { id: string }) {
      runner = useLatestWinsCommand(id);
      return null;
    }
    const tree = (id: string) => (
      <FieldDataSourceProvider dataSource={fake}>
        <Probe id={id} />
      </FieldDataSourceProvider>
    );
    const view = render(tree('insp-A'));

    const first = runner!.submit(restructure(1)); // in flight for A
    const queuedForA = runner!.submit(restructure(2)); // queued behind it, made for A
    view.rerender(tree('insp-B')); // the editor moves to another inspection (same hook instance)

    calls[0]!.settle({ ok: true });
    await flush();

    // The in-flight write finished for A; the queued snapshot of A is dropped, not sent to B.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.id).toBe('insp-A');
    expect(isIgnored((await queuedForA) as FieldRunResult<unknown>)).toBe(true);
    await first;

    // A request made after the move goes to B.
    void runner!.submit(restructure(3));
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.id).toBe('insp-B');
  });
});
