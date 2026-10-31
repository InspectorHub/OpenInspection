// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { CommandResult, FieldCommand } from '../commands';
import { FieldDataSourceProvider } from '../context';
import type { FieldDataSource } from '../data-source';
import { m } from '../i18n';
import { MAX_PHOTO_BYTES } from '../shared/photo-limits';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import type { FakeDataSource } from '../testing/fake-data-source';
import { useReportCoverWrites } from './useReportCoverWrites';
import type { ReportCoverWrites } from './useReportCoverWrites';

afterEach(cleanup);

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** A fake whose `execute` parks each call until the test settles it. */
function parked() {
  const fake = createFakeDataSource({ data: createEmptyEditorData() });
  const pending: Array<(r: CommandResult<undefined>) => void> = [];
  const sent: FieldCommand[] = [];
  vi.spyOn(fake, 'execute').mockImplementation(((_id: string, cmd: FieldCommand) => {
    sent.push(cmd);
    return new Promise<CommandResult<undefined>>((resolve) => pending.push(resolve));
  }) as FakeDataSource['execute']);
  return { fake, sent, settle: (i: number, r: CommandResult<undefined>) => pending[i]?.(r) };
}

let writes: ReportCoverWrites;
function Harness() {
  writes = useReportCoverWrites('insp-1');
  return null;
}
function mount(ds: FieldDataSource) {
  return render(
    <FieldDataSourceProvider dataSource={ds}>
      <Harness />
    </FieldDataSourceProvider>,
  );
}

const image = () => new Blob(['x'], { type: 'image/jpeg' });
const FAILED = () => m.editor_route_save_failed();

describe('useReportCoverWrites', () => {
  it('sends a set-cover command, and says nothing when it is saved', async () => {
    const { fake, sent, settle } = parked();
    mount(fake);
    act(() => writes.setCover('photo-1'));
    expect(sent).toEqual([{ type: 'set-cover', coverPhotoId: 'photo-1' }]);
    await act(async () => { settle(0, { ok: true }); });
    expect(fake.notifications).toEqual([]);
  });

  it('SAYS so when a cover write is refused (the old fetcher dropped every answer)', async () => {
    const { fake, settle } = parked();
    mount(fake);
    act(() => writes.setCover('photo-1'));
    await act(async () => { settle(0, { ok: false, error: 'no' }); });
    expect(fake.notifications).toEqual([{ message: FAILED(), variant: 'error', durationMs: 8000 }]);
  });

  it('toggling the cover twice quickly ends on the second choice, and the first answer is not reported', async () => {
    const { fake, sent, settle } = parked();
    mount(fake);
    act(() => {
      writes.setCover('photo-1');
      writes.setCover('');
    });
    // The first request is out; the second waits behind it (latest wins), nothing is dropped.
    expect(sent).toEqual([{ type: 'set-cover', coverPhotoId: 'photo-1' }]);
    await act(async () => { settle(0, { ok: false, error: 'late' }); });
    await flush();
    expect(sent).toEqual([{ type: 'set-cover', coverPhotoId: 'photo-1' }, { type: 'set-cover', coverPhotoId: '' }]);
    await act(async () => { settle(1, { ok: true }); });
    // The superseded request's refusal was discarded with it.
    expect(fake.notifications).toEqual([]);
  });

  it('sends ONE crop for two presses of the same Save in one frame, silently', async () => {
    const { fake, sent, settle } = parked();
    mount(fake);
    const input = { sourceKey: 'k1', crop: '{"x":1}', image: image() };
    act(() => {
      writes.cropCover(input);
      writes.cropCover({ ...input, image: image() });
    });
    expect(sent.filter((c) => c.type === 'crop-cover')).toHaveLength(1);
    expect(fake.notifications).toEqual([]);
    await act(async () => { settle(0, { ok: true }); });
    expect(fake.notifications).toEqual([]);
  });

  it('a different crop that arrives while one is in flight is SENT after it, ends as the last one, and is not reported as a failure', async () => {
    const { fake, sent, settle } = parked();
    mount(fake);
    act(() => {
      writes.cropCover({ sourceKey: 'k1', crop: '{"x":1}', image: image() });
      writes.cropCover({ sourceKey: 'k2', crop: '{"x":2}', image: image() });
    });
    // B waits behind A; nothing is dropped and nothing is reported.
    expect(sent.map((c) => (c as { sourceKey: string }).sourceKey)).toEqual(['k1']);
    expect(fake.notifications).toEqual([]);
    await act(async () => { settle(0, { ok: true }); });
    await flush();
    expect(sent.map((c) => (c as { sourceKey: string }).sourceKey)).toEqual(['k1', 'k2']);
    await act(async () => { settle(1, { ok: true }); });
    expect(fake.notifications).toEqual([]);
  });

  it('a third crop replaces the queued second: the server ends on the LAST one the person made', async () => {
    const { sent, fake, settle } = parked();
    mount(fake);
    act(() => {
      writes.cropCover({ sourceKey: 'k1', crop: '{"x":1}', image: image() });
      writes.cropCover({ sourceKey: 'k2', crop: '{"x":2}', image: image() });
      writes.cropCover({ sourceKey: 'k3', crop: '{"x":3}', image: image() });
    });
    await act(async () => { settle(0, { ok: true }); });
    await flush();
    expect(sent.map((c) => (c as { sourceKey: string }).sourceKey)).toEqual(['k1', 'k3']);
    await act(async () => { settle(1, { ok: true }); });
    expect(fake.notifications).toEqual([]);
  });

  it('CONTROL - a later crop after the first settled goes through, and a refused crop is reported', async () => {
    const { fake, sent, settle } = parked();
    mount(fake);
    act(() => writes.cropCover({ sourceKey: 'k1', crop: '{"x":1}', image: image() }));
    await act(async () => { settle(0, { ok: false, error: 'refused' }); });
    expect(fake.notifications).toEqual([{ message: FAILED(), variant: 'error', durationMs: 8000 }]);
    act(() => writes.cropCover({ sourceKey: 'k2', crop: '{"x":1}', image: image() }));
    expect(sent).toHaveLength(2);
    await act(async () => { settle(1, { ok: true }); });
    expect(fake.notifications).toHaveLength(1);
  });

  it('sends the annotation with its section only when there is one, and queues a different one that arrives meanwhile', async () => {
    const { fake, sent, settle } = parked();
    mount(fake);
    act(() => {
      writes.annotate({ itemId: 'i1', photoIndex: 0, nodes: '[]', image: image(), sectionId: 's1' });
      writes.annotate({ itemId: 'i1', photoIndex: 1, nodes: '[]', image: image() });
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'annotate', itemId: 'i1', photoIndex: 0, sectionId: 's1' });
    expect(fake.notifications).toEqual([]);
    await act(async () => { settle(0, { ok: true }); });
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ photoIndex: 1 });
    expect(sent[1]).not.toHaveProperty('sectionId');
  });

  it('sends ONE annotation for the same one pressed twice in one frame', () => {
    const { fake, sent } = parked();
    mount(fake);
    act(() => {
      writes.annotate({ itemId: 'i1', photoIndex: 0, nodes: '[]', image: image() });
      writes.annotate({ itemId: 'i1', photoIndex: 0, nodes: '[]', image: image() });
    });
    expect(sent).toHaveLength(1);
  });
});

describe('useReportCoverWrites: the image is checked before the command is created', () => {
  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
  const tooLarge = () => new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)], { type: 'image/jpeg' });
  const notAnImage = () => new Blob(['%PDF-1.7'], { type: 'image/jpeg' });
  const calls = [
    ['cover crop', 'crop-cover', (img: Blob) => writes.cropCoverChecked({ sourceKey: 'k1', crop: '{}', image: img })],
    ['annotation fallback', 'annotate', (img: Blob) => writes.annotateChecked({ itemId: 'i1', photoIndex: 0, nodes: '[]', image: img })],
  ] as const;

  for (const [name, type, call] of calls) {
    it(`${name}: an image over the ceiling or not an image sends no command, says why once and resolves false`, async () => {
      const { fake, sent } = parked();
      mount(fake);
      let outcomes: boolean[] = [];
      await act(async () => { outcomes = [await call(tooLarge()), await call(notAnImage())]; });
      expect(outcomes).toEqual([false, false]);
      expect(sent).toEqual([]);
      expect(fake.notifications.map((n) => [n.message, n.variant])).toEqual([
        [m.editor_photo_save_too_large(), 'error'],
        [m.editor_photo_save_unsupported_type(), 'error'],
      ]);
    });

    it(`${name}: CONTROL - an admissible image sends exactly one command, silently, and resolves true`, async () => {
      const { fake, sent } = parked();
      mount(fake);
      let ok = false;
      await act(async () => { ok = await call(jpeg()); });
      expect(ok).toBe(true);
      expect(sent.map((c) => c.type)).toEqual([type]);
      expect(fake.notifications).toEqual([]);
    });
  }

  it('the synchronous cropCover / annotate contract is unchanged: they send in the same frame without a check', () => {
    const { fake, sent } = parked();
    mount(fake);
    act(() => writes.cropCover({ sourceKey: 'k1', crop: '{}', image: new Blob(['x']) }));
    expect(sent.map((c) => c.type)).toEqual(['crop-cover']);
  });
});

describe('useReportCoverWrites.annotateChecked: an attempt that was cancelled while the image was checked', () => {
  const tooLarge = () => new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)], { type: 'image/jpeg' });
  const input = (image: Blob) => ({ itemId: 'i1', photoIndex: 0, nodes: '[]', image });

  it('is silent and sends nothing when the listener calls it off', async () => {
    const { fake, sent } = parked();
    mount(fake);
    let ok = true;
    await act(async () => { ok = await writes.annotateChecked(input(tooLarge()), () => false); });
    expect(ok).toBe(false);
    expect(sent).toEqual([]);
    expect(fake.notifications).toEqual([]);
  });

  it('CONTROL - a genuine refusal with a listener that does not call it off is announced once', async () => {
    const { fake } = parked();
    mount(fake);
    await act(async () => { await writes.annotateChecked(input(tooLarge()), () => undefined); });
    expect(fake.notifications.map((n) => n.message)).toEqual([m.editor_photo_save_too_large()]);
  });
});
