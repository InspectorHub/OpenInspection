import { useEffect, useRef } from 'react';

/**
 * Notes are typed into React state on every keystroke and written into the shared results document only when
 * the textarea loses focus (a write per keystroke would bounce back through the document observer and jump the
 * cursor). So text typed and then left behind WITHOUT a blur never reaches the document: the layout swaps under
 * a rotation, the item is closed with the phone's back button, the tab is hidden or the page is closed, and a
 * browser does not reliably fire `blur` for an element that is removed or for a page that goes away.
 *
 * `track` records the latest uncommitted text, `settle` says the field committed it itself, and `flush` commits
 * what is pending: on unmount, on `pagehide`, when the page becomes hidden, and when the owner calls it (leaving
 * the editor). The pending text is committed only while the same item is still the open one, so it can never be
 * written onto another item.
 */
export function useNotesCommitOnLeave(
  itemId: string | undefined,
  commit: (text: string) => void,
  flushRef?: { current: (() => void) | null },
): { track: (text: string) => void; settle: () => void } {
  const pending = useRef<{ itemId: string | undefined; text: string } | null>(null);
  const latest = useRef({ itemId, commit });
  latest.current = { itemId, commit };

  useEffect(() => {
    const flush = () => {
      const held = pending.current;
      pending.current = null;
      if (held && held.itemId === latest.current.itemId) latest.current.commit(held.text);
    };
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

  return {
    track: (text) => { pending.current = { itemId: latest.current.itemId, text }; },
    settle: () => { pending.current = null; },
  };
}
