import { describe, expect, it, vi } from 'vitest';
import { m } from '../i18n';
import { guardedSave, refuseInadmissibleImage } from './photo-save-guard';
import { MAX_PHOTO_BYTES } from '../shared/photo-limits';

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('guardedSave', () => {
  it('holds the key while the task runs and releases it when it settles', async () => {
    const notify = vi.fn();
    const inFlight = new Set<string>();
    let finish: () => void = () => {};
    guardedSave({ notify }, inFlight, 'k', () => new Promise<void>((resolve) => { finish = resolve; }));
    expect(inFlight.has('k')).toBe(true);
    finish();
    await flush();
    expect(inFlight.has('k')).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('a task that rejects tells the person, releases the key and leaves no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const notify = vi.fn();
      const inFlight = new Set<string>();
      guardedSave({ notify }, inFlight, 'k', () => Promise.reject(new Error('r2 down')));
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(notify).toHaveBeenCalledWith(m.editor_photo_save_failed(), 'error');
      expect(inFlight.has('k')).toBe(false);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('a task that throws before returning a promise is reported the same way', async () => {
    const notify = vi.fn();
    const inFlight = new Set<string>();
    guardedSave({ notify }, inFlight, 'k', () => { throw new Error('sync'); });
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(inFlight.has('k')).toBe(false);
  });
});

describe('refuseInadmissibleImage and a cancelled attempt', () => {
  const huge = () => new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)]);

  it('a genuine refusal says why exactly once and stops the caller', async () => {
    const notify = vi.fn();
    const stop = await refuseInadmissibleImage({ notify }, huge(), () => undefined);
    expect(stop).toBe(true);
    expect(notify.mock.calls).toEqual([[m.editor_photo_save_too_large(), 'error']]);
  });

  it('an attempt cancelled before the check ended is called off with no notice', async () => {
    const notify = vi.fn();
    const stop = await refuseInadmissibleImage({ notify }, huge(), () => false);
    expect(stop).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it('CONTROL - with no listener a refusal is still announced', async () => {
    const notify = vi.fn();
    expect(await refuseInadmissibleImage({ notify }, huge())).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
