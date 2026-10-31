// @vitest-environment happy-dom
/**
 * `usePresence` takes the socket URL from `urls.presenceSocket` and the user id from
 * `session().userId` of the host's data source, instead of building the URL from
 * `window.location` and taking the id from the route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { FieldDataSourceProvider } from '../context';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import { usePresence } from './usePresence';

class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  private listeners = new Map<string, Array<(ev: unknown) => void>>();
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    for (const cb of this.listeners.get('open') ?? []) cb({});
  }
  /** The socket going away, as the server or the browser does it. */
  drop() {
    this.readyState = 3;
    for (const cb of this.listeners.get('close') ?? []) cb({});
  }
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(urls: Parameters<typeof createFakeDataSource>[0]['urls'], userId: string | null | undefined) {
  const seen: { status?: string } = {};
  const ds = createFakeDataSource({ data: createEmptyEditorData(), urls, session: userId === undefined ? {} : { userId } });
  function Probe() {
    const p = usePresence({ inspectionId: 'insp-1', userName: 'Inspector' });
    seen.status = p.status;
    return null;
  }
  render(
    <FieldDataSourceProvider dataSource={ds}>
      <Probe />
    </FieldDataSourceProvider>,
  );
  return seen;
}

describe('usePresence', () => {
  it('opens the socket at the URL the host data source gives, and says hello as the session user', () => {
    const presenceSocket = vi.fn((id: string) => `wss://host.example/api/inspections/${id}/presence/ws`);
    mount({ presenceSocket }, 'user-7');
    expect(presenceSocket).toHaveBeenCalledWith('insp-1');
    expect(FakeSocket.instances.map((s) => s.url)).toEqual(['wss://host.example/api/inspections/insp-1/presence/ws']);

    act(() => FakeSocket.instances[0].open());
    expect(JSON.parse(FakeSocket.instances[0].sent[0])).toEqual({
      type: 'hello',
      userId: 'user-7',
      name: 'Inspector',
      photoUrl: null,
    });
  });

  it('a host with no identity for the viewer opens no socket and announces nothing', () => {
    const presenceSocket = vi.fn((id: string) => `wss://host.example/api/inspections/${id}/presence/ws`);
    const seen = mount({ presenceSocket }, null);
    expect(FakeSocket.instances).toEqual([]);
    expect(seen.status).toBe('unavailable');
  });

  it('a socket that drops on its own shows reconnecting (control)', () => {
    const handle = mountWithHandle();
    act(() => FakeSocket.instances[0].open());
    expect(handle.status).toBe('connected');
    act(() => FakeSocket.instances[0].drop());
    expect(handle.status).toBe('reconnecting');
  });

  it('a close the hook asked for leaves the state alone when the socket reports it later', () => {
    // The late close event of a socket the hook itself closed has nothing to report and nothing to reconnect; it must not
    // flip the status to 'reconnecting', and it must not touch state at all (it can arrive after the page is gone).
    const handle = mountWithHandle();
    act(() => FakeSocket.instances[0].open());
    act(() => handle.close());
    act(() => FakeSocket.instances[0].drop());
    expect(handle.status).not.toBe('reconnecting');
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe('usePresence: close() and switching inspections', () => {
  afterEach(() => vi.useRealTimers());

  function mountSwitchable() {
    const handle: { status?: string; connected?: boolean; close: () => void } = { close: () => undefined };
    const ds = createFakeDataSource({
      data: createEmptyEditorData(),
      urls: { presenceSocket: (id: string) => `wss://host.example/api/inspections/${id}/presence/ws` },
      session: { userId: 'user-7' },
    });
    function Probe({ id }: { id: string }) {
      const p = usePresence({ inspectionId: id, userName: 'Inspector' });
      handle.status = p.status;
      handle.connected = p.connected;
      handle.close = p.close;
      return null;
    }
    const ui = (id: string) => (
      <FieldDataSourceProvider dataSource={ds}>
        <Probe id={id} />
      </FieldDataSourceProvider>
    );
    const view = render(ui('insp-1'));
    return { handle, switchTo: (id: string) => view.rerender(ui(id)) };
  }

  it('an explicit close() while mounted leaves status and connected telling the same story', () => {
    const { handle } = mountSwitchable();
    act(() => FakeSocket.instances[0].open());
    expect(handle.connected).toBe(true);
    expect(handle.status).toBe('connected');
    act(() => handle.close());
    expect(handle.connected).toBe(false);
    expect(handle.status).toBe('unavailable');
  });

  it('the late close of the OLD inspection socket changes nothing and opens no second socket', () => {
    vi.useFakeTimers();
    const { handle, switchTo } = mountSwitchable();
    act(() => FakeSocket.instances[0].open());
    switchTo('insp-2');
    expect(FakeSocket.instances.map((s) => s.url.includes('insp-2'))).toEqual([false, true]);
    act(() => FakeSocket.instances[1].open());
    expect(handle.connected).toBe(true);
    // The first socket's close event arrives only now, after the effect re-ran for the new inspection.
    act(() => FakeSocket.instances[0].drop());
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(handle.connected).toBe(true);
    expect(handle.status).toBe('connected');
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('a reconnect already scheduled for the old inspection never fires after the switch', () => {
    vi.useFakeTimers();
    const { switchTo } = mountSwitchable();
    act(() => FakeSocket.instances[0].open());
    act(() => FakeSocket.instances[0].drop()); // schedules a reconnect for insp-1
    switchTo('insp-2');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(FakeSocket.instances.filter((s) => s.url.includes('insp-1'))).toHaveLength(1);
    expect(FakeSocket.instances.filter((s) => s.url.includes('insp-2'))).toHaveLength(1);
  });

  it('CONTROL - the CURRENT socket dropping still shows reconnecting and reconnects', () => {
    vi.useFakeTimers();
    const { handle, switchTo } = mountSwitchable();
    switchTo('insp-2');
    act(() => FakeSocket.instances[1].open());
    act(() => FakeSocket.instances[1].drop());
    expect(handle.status).toBe('reconnecting');
    expect(handle.connected).toBe(false);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(FakeSocket.instances).toHaveLength(3);
    expect(FakeSocket.instances[2].url).toContain('insp-2');
  });
});

function mountWithHandle() {
  const handle: { status?: string; close: () => void } = { close: () => undefined };
  const ds = createFakeDataSource({
    data: createEmptyEditorData(),
    urls: { presenceSocket: (id: string) => `wss://host.example/api/inspections/${id}/presence/ws` },
    session: { userId: 'user-7' },
  });
  function Probe() {
    const p = usePresence({ inspectionId: 'insp-1', userName: 'Inspector' });
    handle.status = p.status;
    handle.close = p.close;
    return null;
  }
  render(
    <FieldDataSourceProvider dataSource={ds}>
      <Probe />
    </FieldDataSourceProvider>,
  );
  return handle;
}
