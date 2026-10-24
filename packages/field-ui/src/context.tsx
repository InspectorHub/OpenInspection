import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CommandData, CommandResult, FieldCommand } from './commands';
import type { FieldDataSource, FieldHostSlots } from './data-source';
import { m } from './i18n';

const DataSourceContext = createContext<FieldDataSource | null>(null);
const NO_SLOTS: FieldHostSlots = {};
const SlotsContext = createContext<FieldHostSlots>(NO_SLOTS);

export interface FieldDataSourceProviderProps {
  dataSource: FieldDataSource;
  /** Host-supplied UI (theme control, PDF export). Absent slots hide their entry points. */
  slots?: FieldHostSlots;
  children?: ReactNode;
}

export function FieldDataSourceProvider({ dataSource, slots, children }: FieldDataSourceProviderProps) {
  return (
    <DataSourceContext.Provider value={dataSource}>
      <SlotsContext.Provider value={slots ?? NO_SLOTS}>{children}</SlotsContext.Provider>
    </DataSourceContext.Provider>
  );
}

/** The data source of the nearest provider. Throws outside one: a silent null would fail much later. */
export function useFieldDataSource(): FieldDataSource {
  const dataSource = useContext(DataSourceContext);
  if (dataSource === null) {
    throw new Error('useFieldDataSource must be used inside a <FieldDataSourceProvider>.');
  }
  return dataSource;
}

/** The host-supplied UI slots; an empty object when the provider was given none. */
export function useFieldSlots(): FieldHostSlots {
  return useContext(SlotsContext);
}

const NOT_REQUIRED = async (): Promise<boolean> => true;

/**
 * The host's human check as one stable function, FAIL-CLOSED.
 *
 * - `slots.ensureHuman` present: that function.
 * - `slots.humanCheck === 'not-required'` (the host's explicit opt-out): answers `true` at once.
 * - Neither: refuses (`false`) and shows the person why, because a host that forgot the slot must not
 *   silently lose the check. The caller treats `false` as "do not send".
 *
 * The function keeps its identity across renders for as long as the slot and data source do.
 */
export function useFieldEnsureHuman(): () => Promise<boolean> {
  const slots = useFieldSlots();
  const dataSource = useFieldDataSource();
  const { ensureHuman, humanCheck } = slots;
  const refuse = useCallback(async (): Promise<boolean> => {
    dataSource.notify(m.editor_human_check_unavailable(), 'error');
    return false;
  }, [dataSource]);
  if (ensureHuman) return ensureHuman;
  return humanCheck === 'not-required' ? NOT_REQUIRED : refuse;
}

/**
 * What `run` answers. `ignored: true` means the call was dropped because another
 * command of this hook was still in flight; nothing was sent and the caller must
 * treat it as a no-op (not as a failure to report).
 */
export type IgnoredRun = { ok: false; ignored: true; error?: undefined };
export type FieldRunResult<D> = CommandResult<D> | IgnoredRun;

/**
 * True when `run` dropped the call because another command of this hook was in flight. Check this FIRST:
 * an ignored call is neither success nor failure (the first request is still running), so a consumer that
 * toasts an error or rolls back on `!ok` would undo work that is about to succeed.
 */
export function isIgnored<D>(result: FieldRunResult<D>): result is IgnoredRun {
  return (result as IgnoredRun).ignored === true;
}

export interface FieldCommandRunner {
  run<C extends FieldCommand>(cmd: C): Promise<FieldRunResult<CommandData<C>>>;
  /** True from the call until the answer settles. Render state only; the guard is synchronous and separate. */
  busy: boolean;
  /**
   * The guard itself, read synchronously: true from the moment a `run` started (in the same frame, before any
   * render) until it settles. Use it to decide, BEFORE changing UI state, whether a `run` would be dropped
   * (an optimistic update that a dropped call must not make). It is the same ref `run` tests, not a second
   * guard: `run` stays the only thing that can start a request.
   */
  isBusy(): boolean;
}

/**
 * Identity of one request: the inspection plus the whole command. A retry of the SAME request holds its key;
 * any other request (another inspection, another payload of the same op, e.g. deleting a different row after
 * a timed-out delete) mints its own, so it can never read as a replay of the failed one. A payload that cannot
 * be serialised falls back to `type` (or `type:op`), which only widens what counts as "the same request".
 */
function requestIdentity(inspectionId: string, cmd: FieldCommand): string {
  try {
    return `${inspectionId}|${JSON.stringify(cmd, blobReplacer)}`;
  } catch {
    return `${inspectionId}|${'op' in cmd ? `${cmd.type}:${cmd.op}` : cmd.type}`;
  }
}

/** One stable number per Blob object, for the lifetime of that object. */
const blobTokens = new WeakMap<Blob, number>();
let nextBlobToken = 1;

/**
 * `JSON.stringify` turns a Blob or File into `{}`, which would make an upload of one photo and an upload of
 * another read as the same request (the second would then carry the first one's held key). A Blob stands for
 * itself: its size, type, name and modification time, plus a per-object token, so the same object is the same
 * request and any other object is a different one even when its bytes happen to match.
 */
function blobReplacer(_key: string, value: unknown): unknown {
  if (typeof Blob === 'undefined' || !(value instanceof Blob)) return value;
  let token = blobTokens.get(value);
  if (token === undefined) {
    token = nextBlobToken;
    nextBlobToken += 1;
    blobTokens.set(value, token);
  }
  const file = value as Partial<File>;
  return { blob: token, size: value.size, type: value.type, name: file.name ?? null, lastModified: file.lastModified ?? null };
}

/** `crypto.randomUUID` needs a secure context and a recent WebView; fall back so a missing one cannot block a write. */
function mintKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The guarded write channel: the only caller of `FieldDataSource.execute` in the
 * package. It reproduces `useGuardedSubmit` (app/hooks/useGuardedSubmit.ts):
 *
 * - Same-frame guard. `inFlight` is a ref set synchronously, so two `run` calls
 *   in one frame send ONE request; the second answers `{ ok: false, ignored: true }`.
 * - Idempotency key. Minted on the first attempt, HELD across a retry of a failed
 *   attempt, ROTATED after an `ok` answer. The rotation is written into the ref
 *   before the guard is released, so no call can ever carry a spent key. Unlike the
 *   host hook (one key per hook), the held key is tied to the request (inspection
 *   plus the whole command): a different request mints its own, so a failed
 *   `unit:delete` of one row cannot make the delete of another row read as its replay.
 * - `busy` mirrors the in-flight state for rendering.
 * - After unmount no state is set, but the pending promise still settles.
 *
 * A host `execute` that rejects is reported as `{ ok: false, error }` and counts as
 * a failed attempt (the key is held). Use one hook per write surface, as with
 * `useGuardedSubmit`.
 */
export function useFieldCommand(inspectionId: string): FieldCommandRunner {
  const dataSource = useFieldDataSource();
  const [busy, setBusy] = useState(false);
  /** Set synchronously inside `run`: the only guard a same-frame double call meets. */
  const inFlight = useRef(false);
  const mounted = useRef(true);
  /** The key a retry must carry, with the command it belongs to. Null means "mint on next attempt". */
  const heldKey = useRef<{ key: string; command: string } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async <C extends FieldCommand>(cmd: C): Promise<FieldRunResult<CommandData<C>>> => {
      if (inFlight.current) return { ok: false, ignored: true };
      inFlight.current = true;
      if (mounted.current) setBusy(true);
      let result: FieldRunResult<CommandData<C>>;
      try {
        const identity = requestIdentity(inspectionId, cmd);
        if (heldKey.current === null || heldKey.current.command !== identity) {
          heldKey.current = { key: mintKey(), command: identity };
        }
        const idempotencyKey = heldKey.current.key;
        // busy-controls-allow: this hook IS the guard - inFlight above is set before this line, so a second same-frame call returned already
        result = await dataSource.execute(inspectionId, cmd, { idempotencyKey });
        // Rotate BEFORE releasing the guard, as useGuardedSubmit does.
        if (result.ok) heldKey.current = null;
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : 'The command failed.' };
      } finally {
        // Every path releases the guard, including a throw before `execute` and a malformed answer.
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
      return result;
    },
    [dataSource, inspectionId],
  );

  const isBusy = useCallback(() => inFlight.current, []);

  return { run, busy, isBusy };
}
