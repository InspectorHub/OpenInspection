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
});
