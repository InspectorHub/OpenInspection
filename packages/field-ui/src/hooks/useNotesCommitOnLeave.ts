import { useCallback, useEffect, useMemo, useRef } from 'react';

/** How long the person stops typing before the draft is committed anyway. A pause is a safe moment: no keystroke is racing the echo. */
const IDLE_MS = 1000;

/**
 * Notes are typed into React state on every keystroke and written into the shared results document only when
 * the textarea loses focus (a write per keystroke would bounce back through the document observer and jump the
 * cursor). So text typed and then left behind WITHOUT a blur never reaches the document: the layout swaps under
 * a rotation, the item is closed with the phone's back button, the tab is hidden or the page is closed, and a
 * browser does not reliably fire `blur` for an element that is removed or for a page that goes away.
 *
 * `track` records the latest uncommitted text, `settle` says the field committed it itself, and `flush` commits
 * what is pending: on unmount, on `pagehide`, when the page becomes hidden, when the owner calls it (leaving the
 * editor), and after a second without a keystroke. The idle commit is safe because the field shows `result.notes`, which
 * the commit echoes back unchanged: the text under the caret is the text that was just committed. The pending text
 * goes to the item it was typed into (the commit is told which), so it can never be written onto another item.
 */
export function useNotesCommitOnLeave(
  itemId: string | undefined,
  commit: (text: string, itemId?: string) => void,
  flushRef?: { current: (() => void) | null },
): { track: (text: string) => void; settle: () => void; composition: { onCompositionStart: () => void; onCompositionEnd: () => void } } {
  const pending = useRef<{ itemId: string | undefined; text: string } | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // An IME composition is in progress: the idle commit waits (leaving the page still commits, so no text is lost).
  const composing = useRef(false);
  const latest = useRef({ itemId, commit });
  latest.current = { itemId, commit };

  const cancelIdle = useCallback(() => {
    if (idle.current !== null) clearTimeout(idle.current);
    idle.current = null;
  }, []);
  const flush = useCallback(() => {
    cancelIdle();
    const held = pending.current;
    pending.current = null;
    // To the item it was typed into, which may no longer be the open one (another item was opened without a blur).
    if (held) latest.current.commit(held.text, held.itemId);
  }, [cancelIdle]);

  // Another item opened under this editor: the draft goes to the item it was typed into before the field shows the new one.
  // (and some IMEs never send compositionend after an item switch, so the flag is cleared here, and in `settle` for a blur;
  // NOT in `flush`, which also runs when the page is hidden mid-composition and then comes back)
  useEffect(() => () => { composing.current = false; flush(); }, [itemId, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    if (flushRef) flushRef.current = flush;
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      if (flushRef && flushRef.current === flush) flushRef.current = null;
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one registration per mount; the refs carry the latest values
  }, []);

  const armIdle = useCallback(() => {
    cancelIdle();
    idle.current = setTimeout(function onIdle() {
      if (composing.current) idle.current = setTimeout(onIdle, IDLE_MS);
      else flush();
    }, IDLE_MS);
  }, [cancelIdle, flush]);
  const composition = useMemo(
    () => ({
      onCompositionStart: () => { composing.current = true; },
      onCompositionEnd: () => {
        composing.current = false;
        if (pending.current) armIdle();
      },
    }),
    [armIdle],
  );

  return {
    composition,
    track: (text) => {
      pending.current = { itemId: latest.current.itemId, text };
      armIdle();
    },
    settle: () => {
      pending.current = null;
      composing.current = false;
      cancelIdle();
    },
  };
}
