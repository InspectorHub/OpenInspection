// @vitest-environment happy-dom
/**
 * The studio's cover toggle shows the new cover at once and puts back the LAST CONFIRMED one when the save is refused.
 * "Last confirmed" matters with two quick clicks: reverting to what the second click saw would restore a value that was
 * never saved. A save that was superseded says nothing and changes nothing.
 */
import { useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useOptimisticCover } from './useOptimisticCover';

afterEach(cleanup);

type Cover = { coverPhotoId: string | null };
type Settle = (ok: boolean | null) => void;

function setup(initial: string | null) {
  const settles: Array<{ id: string; settle: Settle }> = [];
  const hook = renderHook(() => {
    const [inspection, setInspection] = useState<Cover>({ coverPhotoId: initial });
    const toggle = useOptimisticCover({ inspection, setInspection }, (id, onResult) => { settles.push({ id, settle: onResult }); });
    return { cover: inspection.coverPhotoId, toggle, setInspection };
  });
  return { hook, settles };
}

describe('useOptimisticCover', () => {
  it('shows the new cover at once, keeps it once the save is confirmed, and clears it with the next press', () => {
    const { hook, settles } = setup(null);
    act(() => hook.result.current.toggle('a.jpg'));
    expect(hook.result.current.cover).toBe('a.jpg');
    act(() => settles[0]!.settle(true));
    expect(hook.result.current.cover).toBe('a.jpg');
    act(() => hook.result.current.toggle('a.jpg'));
    expect(hook.result.current.cover).toBeNull();
    expect(settles.map((s) => s.id)).toEqual(['a.jpg', '']);
  });

  it('a refused save puts the previous cover back', () => {
    const { hook, settles } = setup('old.jpg');
    act(() => hook.result.current.toggle('a.jpg'));
    act(() => settles[0]!.settle(false));
    expect(hook.result.current.cover).toBe('old.jpg');
  });

  it('two quick presses that both fail end on the last CONFIRMED cover, not on the first press', () => {
    const { hook, settles } = setup('old.jpg');
    act(() => hook.result.current.toggle('a.jpg'));
    act(() => hook.result.current.toggle('b.jpg'));
    expect(hook.result.current.cover).toBe('b.jpg');
    act(() => settles[0]!.settle(false)); // the first refusal arrives after the second press: the newer choice stands
    expect(hook.result.current.cover).toBe('b.jpg');
    act(() => settles[1]!.settle(false));
    expect(hook.result.current.cover).toBe('old.jpg'); // never 'a.jpg': that was not saved either
  });

  it('a first press that is confirmed and a second that fails ends on the first', () => {
    const { hook, settles } = setup(null);
    act(() => hook.result.current.toggle('a.jpg'));
    act(() => hook.result.current.toggle('b.jpg'));
    act(() => settles[0]!.settle(true));
    act(() => settles[1]!.settle(false));
    expect(hook.result.current.cover).toBe('a.jpg');
  });

  it('a superseded save says nothing and confirms nothing; the newer one decides', () => {
    const { hook, settles } = setup('old.jpg');
    act(() => hook.result.current.toggle('a.jpg'));
    act(() => hook.result.current.toggle('b.jpg'));
    act(() => settles[0]!.settle(null));
    expect(hook.result.current.cover).toBe('b.jpg');
    act(() => settles[1]!.settle(false));
    expect(hook.result.current.cover).toBe('old.jpg');
  });

  it('a cover that moved with its photo (a re-baked file) is not undone by a later refusal of an older press', () => {
    const { hook, settles } = setup('old.jpg');
    act(() => hook.result.current.toggle('a.jpg'));
    act(() => hook.result.current.setInspection((prev) => ({ ...prev, coverPhotoId: 'a-rebaked.jpg' })));
    act(() => settles[0]!.settle(false));
    expect(hook.result.current.cover).toBe('a-rebaked.jpg');
  });
});
