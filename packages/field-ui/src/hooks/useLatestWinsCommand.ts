import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandData, FieldCommand } from '../commands';
import { useFieldCommand } from '../context';
import type { FieldRunResult, IgnoredRun } from '../context';

/** What `submit` answers for a request that was replaced by a newer one: nothing of it was (or will be) reported. */
const SUPERSEDED: IgnoredRun = { ok: false, ignored: true };

export interface LatestWinsRunner {
  /**
   * Send `cmd`, or queue it behind the request in flight. A newer request REPLACES a queued one, so at most
   * the request in flight plus the newest one ever wait. The promise answers the real result of THIS request,
   * or `{ ok: false, ignored: true }` (check `isIgnored`) when a newer request superseded it: its answer, if
   * one arrived, is discarded, as an aborted submit never delivered one.
   */
  submit<C extends FieldCommand>(cmd: C): Promise<FieldRunResult<CommandData<C>>>;
  /** True from the first request until the last one settles. Render state only. */
  busy: boolean;
}

interface Waiter {
  resolve: (r: FieldRunResult<unknown>) => void;
}

interface Entry {
  cmd: FieldCommand;
  /** The inspection this request was made for: a queued request is never sent to another one. */
  inspectionId: string;
  /** `JSON.stringify(cmd)`, or null when the payload cannot be serialised (then no two requests compare equal). */
  identity: string | null;
  waiters: Waiter[];
}

function identityOf(cmd: FieldCommand): string | null {
  try {
    return JSON.stringify(cmd);
  } catch {
    return null;
  }
}

/**
 * A write channel where the NEWEST request wins, for whole-document writes (a restructure replaces the
 * template snapshot): dropping the later call, as `useFieldCommand` does, would lose the edit.
 *
 * - One request is in flight at a time, so the server sees the writes in the order they were made.
 * - While it is in flight a newer request replaces whatever is queued; the queued one is sent as soon as the
 *   in-flight one settles, whether that one succeeded or failed.
 * - When a request settles and a newer one is waiting, its own answer is discarded (`ignored`).
 * - The same-frame guard: the decision is made on synchronous refs. A request identical to the one in flight
 *   (two triggers for one snapshot in one frame) is not sent again; it shares the in-flight answer, and a
 *   queued newer request that it equals is moot, so it is superseded.
 * - Sending goes through `useFieldCommand`, the guarded write channel, and only ever while it is idle, so its
 *   own overlap rule never fires.
 * - After unmount no state is set, but the queued newest request is still sent: it is the user's last edit.
 */
export function useLatestWinsCommand(inspectionId: string): LatestWinsRunner {
  const { run } = useFieldCommand(inspectionId);
  const runRef = useRef(run);
  runRef.current = run;
  const inspectionIdRef = useRef(inspectionId);
  inspectionIdRef.current = inspectionId;
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef<Entry | null>(null);
  const queued = useRef<Entry | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const drain = useCallback(async (first: Entry) => {
    let current: Entry | null = first;
    while (current !== null) {
      inFlight.current = current;
      const result: FieldRunResult<unknown> = await runRef.current(current.cmd);
      let next: Entry | null = queued.current;
      queued.current = null;
      if (next !== null && next.inspectionId !== inspectionIdRef.current) {
        // The editor moved to another inspection while this request was in flight; the queued snapshot
        // belongs to the old one and must not be written to the new one.
        for (const w of next.waiters) w.resolve(SUPERSEDED);
        next = null;
      }
      // A superseded request's answer is dropped; the newest request's answer is the one reported.
      for (const w of current.waiters) w.resolve(next === null ? result : SUPERSEDED);
      current = next;
    }
    inFlight.current = null;
    if (mounted.current) setBusy(false);
  }, []);

  const submit = useCallback(
    <C extends FieldCommand>(cmd: C): Promise<FieldRunResult<CommandData<C>>> =>
      new Promise((resolve) => {
        const waiter: Waiter = { resolve: resolve as Waiter['resolve'] };
        const identity = identityOf(cmd);
        const running = inFlight.current;
        if (running === null) {
          // Taken before this call returns, so a second same-frame call meets a busy channel.
          const entry: Entry = { cmd, inspectionId: inspectionIdRef.current, identity, waiters: [waiter] };
          inFlight.current = entry;
          if (mounted.current) setBusy(true);
          void drain(entry);
          return;
        }
        if (identity !== null && identity === running.identity) {
          // The newest snapshot is already on its way: join it, and nothing older still waiting matters.
          if (queued.current !== null) for (const w of queued.current.waiters) w.resolve(SUPERSEDED);
          queued.current = null;
          running.waiters.push(waiter);
          return;
        }
        if (queued.current !== null) {
          // Replace the queued request; keep its callers' promises settling (as superseded).
          for (const w of queued.current.waiters) w.resolve(SUPERSEDED);
        }
        queued.current = { cmd, inspectionId: inspectionIdRef.current, identity, waiters: [waiter] };
      }),
    [drain],
  );

  return { submit, busy };
}
