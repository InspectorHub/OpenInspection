// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { CommandResult, FieldCommand } from './commands';
import type { FieldDataSource, FieldHostSlots } from './data-source';
import { FieldDataSourceProvider, isIgnored, useFieldCommand, useFieldDataSource, useFieldSlots } from './context';
import type { FieldRunResult } from './context';
import { createEmptyEditorData, createFakeDataSource } from './testing/fake-data-source';
import type { FakeDataSource } from './testing/fake-data-source';

afterEach(cleanup);

/** A controllable `execute`: each call parks until the test settles it. */
function deferredFake() {
  const fake = createFakeDataSource({ data: createEmptyEditorData() });
  const pending: Array<(r: CommandResult<undefined>) => void> = [];
  const keys: Array<string | undefined> = [];
  const spy = vi.spyOn(fake, 'execute').mockImplementation(((_id: string, _cmd: FieldCommand, opts?: { idempotencyKey?: string }) => {
    keys.push(opts?.idempotencyKey);
    return new Promise<CommandResult<undefined>>((resolve) => pending.push(resolve));
  }) as FakeDataSource['execute']);
  return { fake, spy, keys, settle: (i: number, r: CommandResult<undefined>) => pending[i]?.(r) };
}

const COMPLETE: FieldCommand = { type: 'complete' };

function Harness({ results, cmd = COMPLETE }: { results?: FieldRunResult<unknown>[]; cmd?: FieldCommand }) {
  const { run, busy } = useFieldCommand('insp-1');
  return (
    <>
      <button type="button" onClick={() => void run(cmd).then((r) => results?.push(r))}>
        go
      </button>
      <span data-testid="busy">{String(busy)}</span>
    </>
  );
}

function renderWith(ds: FieldDataSource, ui: React.ReactElement, slots?: FieldHostSlots) {
  return render(
    <FieldDataSourceProvider dataSource={ds} slots={slots}>
      {ui}
    </FieldDataSourceProvider>,
  );
}

const flush = () => act(async () => { await Promise.resolve(); });

describe('useFieldCommand', () => {
  it('sends ONE request for two triggers in one frame', () => {
    const { fake, spy } = deferredFake();
    renderWith(fake, <Harness />);
    const btn = screen.getByRole('button');
    act(() => { btn.click(); btn.click(); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('CONTROL - a later separate trigger goes through once the first settled', async () => {
    const { fake, spy, settle } = deferredFake();
    renderWith(fake, <Harness />);
    const btn = screen.getByRole('button');
    act(() => { btn.click(); });
    settle(0, { ok: true });
    await flush();
    act(() => { btn.click(); });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('answers a dropped call with ignored, not an error', async () => {
    const { fake, settle } = deferredFake();
    const results: FieldRunResult<unknown>[] = [];
    renderWith(fake, <Harness results={results} />);
    const btn = screen.getByRole('button');
    act(() => { btn.click(); btn.click(); });
    await flush();
    expect(results).toEqual([{ ok: false, ignored: true }]);
    settle(0, { ok: true });
    await flush();
    expect(results).toHaveLength(2);
    expect(results[1]).toEqual({ ok: true });
  });

  it('holds the idempotency key across a failed attempt and rotates it after success', async () => {
    const { fake, keys, settle } = deferredFake();
    renderWith(fake, <Harness />);
    const btn = screen.getByRole('button');
    act(() => { btn.click(); });
    settle(0, { ok: false, error: 'boom' });
    await flush();
    act(() => { btn.click(); });
    settle(1, { ok: true });
    await flush();
    act(() => { btn.click(); });
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('holds the key when execute rejects, and reports the rejection as a failed result', async () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    const keys: Array<string | undefined> = [];
    let calls = 0;
    vi.spyOn(fake, 'execute').mockImplementation(((_id: string, _cmd: FieldCommand, opts?: { idempotencyKey?: string }) => {
      keys.push(opts?.idempotencyKey);
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: true });
    }) as FakeDataSource['execute']);
    const results: FieldRunResult<unknown>[] = [];
    renderWith(fake, <Harness results={results} />);
    const btn = screen.getByRole('button');
    act(() => { btn.click(); });
    await flush();
    expect(results[0]).toEqual({ ok: false, error: 'offline' });
    act(() => { btn.click(); });
    await flush();
    expect(keys[1]).toBe(keys[0]);
  });

  it('mints a separate key for a different command after a failed attempt', async () => {
    const { fake, keys, settle } = deferredFake();
    const { rerender } = renderWith(fake, <Harness cmd={{ type: 'unit', op: 'delete', unitId: 'u1' }} />);
    act(() => { screen.getByRole('button').click(); });
    settle(0, { ok: false, error: 'boom' });
    await flush();
    rerender(
      <FieldDataSourceProvider dataSource={fake}>
        <Harness cmd={{ type: 'unit', op: 'create', name: 'A' }} />
      </FieldDataSourceProvider>,
    );
    act(() => { screen.getByRole('button').click(); });
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('mints a separate key for another payload of the same op, and for another inspection', async () => {
    const { fake, keys, settle } = deferredFake();
    const { rerender } = renderWith(fake, <Harness cmd={{ type: 'unit', op: 'delete', unitId: 'u1' }} />);
    act(() => { screen.getByRole('button').click(); });
    settle(0, { ok: false, error: 'timed out' });
    await flush();
    // The server may have applied u1. Deleting u2 must not be read as a replay of that request.
    rerender(
      <FieldDataSourceProvider dataSource={fake}>
        <Harness cmd={{ type: 'unit', op: 'delete', unitId: 'u2' }} />
      </FieldDataSourceProvider>,
    );
    act(() => { screen.getByRole('button').click(); });
    expect(keys[1]).not.toBe(keys[0]);
    // Retrying the SAME request after a failure still holds its key.
    settle(1, { ok: false, error: 'timed out' });
    await flush();
    act(() => { screen.getByRole('button').click(); });
    expect(keys[2]).toBe(keys[1]);
  });

  it('releases the guard when something throws before execute: a later call still reaches the host', async () => {
    const { fake, spy } = deferredFake();
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined });
    try {
      renderWith(fake, <Harness />);
      act(() => { screen.getByRole('button').click(); });
      await flush();
      // No randomUUID (older WebView): the key still mints through the fallback and the call is sent.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[2]?.idempotencyKey).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: original });
    }
  });

  it('releases the guard after a synchronous throw inside execute, and after a malformed answer', async () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    let calls = 0;
    const spy = vi.spyOn(fake, 'execute').mockImplementation((() => {
      calls += 1;
      if (calls === 1) throw new Error('sync boom');
      if (calls === 2) return Promise.resolve(undefined);
      return Promise.resolve({ ok: true });
    }) as unknown as FakeDataSource['execute']);
    const results: FieldRunResult<unknown>[] = [];
    renderWith(fake, <Harness results={results} />);
    const btn = screen.getByRole('button');
    act(() => { btn.click(); });
    await flush();
    act(() => { btn.click(); });
    await flush();
    act(() => { btn.click(); });
    await flush();
    expect(spy).toHaveBeenCalledTimes(3);
    expect(results[0]).toEqual({ ok: false, error: 'sync boom' });
    expect(results[1]?.ok).toBe(false);
    expect(results[2]).toEqual({ ok: true });
  });

  it('isIgnored tells a dropped call from a failure, so a consumer does not roll back work still in flight', async () => {
    const { fake, settle } = deferredFake();
    const results: FieldRunResult<unknown>[] = [];
    renderWith(fake, <Harness results={results} />);
    const btn = screen.getByRole('button');
    act(() => { btn.click(); btn.click(); });
    await flush();
    expect(results).toHaveLength(1);
    const dropped = results[0]!;
    expect(isIgnored(dropped)).toBe(true);
    settle(0, { ok: false, error: 'real failure' });
    await flush();
    act(() => { btn.click(); });
    settle(1, { ok: false, error: 'real failure' });
    await flush();
    expect(results.some((r) => !isIgnored(r) && r.ok === false && r.error === 'real failure')).toBe(true);
    expect(isIgnored({ ok: false, error: 'real failure' })).toBe(false);
  });

  it('toggles busy from the call until the answer settles', async () => {
    const { fake, settle } = deferredFake();
    renderWith(fake, <Harness />);
    expect(screen.getByTestId('busy').textContent).toBe('false');
    act(() => { screen.getByRole('button').click(); });
    expect(screen.getByTestId('busy').textContent).toBe('true');
    settle(0, { ok: true });
    await flush();
    expect(screen.getByTestId('busy').textContent).toBe('false');
  });

  it('isBusy reads the guard synchronously: true in the same frame as the first run, false once it settles', async () => {
    const { fake, settle } = deferredFake();
    const seen: boolean[] = [];
    function Probe() {
      const { run, isBusy } = useFieldCommand('insp-1');
      return (
        <button
          type="button"
          onClick={() => {
            seen.push(isBusy());
            void run(COMPLETE);
            seen.push(isBusy());
          }}
        >
          go
        </button>
      );
    }
    renderWith(fake, <Probe />);
    const btn = screen.getByRole('button');
    // Two presses in ONE frame: the second sees the guard the first just took, before any render.
    act(() => { btn.click(); btn.click(); });
    expect(seen).toEqual([false, true, true, true]);
    settle(0, { ok: true });
    await flush();
    seen.length = 0;
    act(() => { btn.click(); });
    expect(seen).toEqual([false, true]);
  });

  it('sets no state after unmount, and the pending call still settles', async () => {
    const { fake, settle } = deferredFake();
    const results: FieldRunResult<unknown>[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = renderWith(fake, <Harness results={results} />);
    act(() => { screen.getByRole('button').click(); });
    unmount();
    settle(0, { ok: true });
    await flush();
    expect(results).toEqual([{ ok: true }]);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('FieldDataSourceProvider', () => {
  function Probe() {
    const ds = useFieldDataSource();
    const slots = useFieldSlots();
    return <span data-testid="probe">{`${ds.platform}|${slots.renderThemeControl ? 'theme' : 'no-theme'}|${slots.pdf ? 'pdf' : 'no-pdf'}`}</span>;
  }

  it('throws a clear error outside a provider', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('inside a <FieldDataSourceProvider>');
    errors.mockRestore();
  });

  it('passes the data source and an empty slot set when none are given', () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData(), platform: 'ios' });
    renderWith(fake, <Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('ios|no-theme|no-pdf');
  });

  it('passes slots through untouched', () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    const run = vi.fn();
    const slots: FieldHostSlots = {
      renderThemeControl: () => null,
      pdf: { run, busy: false, error: null, actionLabel: (label) => label },
    };
    function SlotProbe() {
      const s = useFieldSlots();
      return <button type="button" onClick={() => s.pdf?.run('insp-1')}>pdf</button>;
    }
    renderWith(fake, <><Probe /><SlotProbe /></>, slots);
    expect(screen.getByTestId('probe').textContent).toBe('web|theme|pdf');
    act(() => { screen.getByRole('button', { name: 'pdf' }).click(); });
    expect(run).toHaveBeenCalledWith('insp-1');
  });
});

describe('FakeDataSource contract', () => {
  it('satisfies FieldDataSource and implements the added members', () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() }) satisfies FieldDataSource;
    const ds: FieldDataSource = fake;
    expect(ds.session()).toMatchObject({
      locale: 'en-US',
      timeZone: null,
      dateFormat: 'us',
      timeFormat: '12h',
      tenantDateFormat: 'us',
      tenantTimeFormat: '12h',
    });
    expect(ds.urls.presenceSocket('i1')).toContain('/i1/');
    expect(ds.urls.editorPath('i1')).toContain('i1');
    ds.notify('hello', 'success');
    ds.notify('plain');
    expect(fake.notifications).toEqual([
      { message: 'hello', variant: 'success' },
      { message: 'plain', variant: undefined },
    ]);
  });
});
