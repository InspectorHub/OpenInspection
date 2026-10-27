import { useSyncExternalStore } from 'react';

const FINE = '(any-hover: hover) and (any-pointer: fine)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(FINE);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const snapshot = (): boolean => typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia(FINE).matches;

/**
 * True when some attached pointer can hover and is precise (a mouse or a trackpad), so a keyboard-shortcut hint is of
 * use. A tablet with a keyboard and mouse attached brings it back; a phone or a bare tablet does not have it. On the
 * server, and where the browser cannot say, it is true, so the page renders the same as before until the client knows.
 */
export function useHasFinePointer(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
