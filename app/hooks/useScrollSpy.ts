import { useEffect, useState } from "react";

/**
 * Tracks which section id is "current" within a scroll container. A section is
 * current when its top has scrolled at or above `topOffset` px from the root's
 * top; the current section is the last such one. `getRoot` only sets the offset
 * reference (viewport when it returns null); the scroll listener is always a
 * capture-phase window listener so it fires regardless of which element scrolls
 * (scroll events don't bubble). Returns the first id until a scroll settles, or
 * null when there are no ids.
 */
export function useScrollSpy(
  ids: string[],
  opts: { getRoot: () => HTMLElement | null; topOffset: number },
): string | null {
  const { getRoot, topOffset } = opts;
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join("|");

  useEffect(() => {
    if (ids.length === 0) {
      setActive(null);
      return;
    }
    const root = getRoot();
    const rootTop = root ? root.getBoundingClientRect().top : 0;

    function compute() {
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const relTop = el.getBoundingClientRect().top - rootTop;
        if (relTop <= topOffset) current = id;
      }
      setActive(current);
    }

    compute();
    // capture:true catches scroll from any scroller (events don't bubble).
    window.addEventListener("scroll", compute, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", compute, { capture: true } as EventListenerOptions);
  }, [key, getRoot, topOffset]);

  return active;
}
