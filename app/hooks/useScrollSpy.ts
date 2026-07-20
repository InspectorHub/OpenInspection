import { useEffect, useState } from "react";

/**
 * Tracks which section id is "current" within a scroll container. A section is
 * current when its top has scrolled at or above `topOffset` px from the root's
 * top; the current section is the last such one. Uses a passive scroll
 * listener on the resolved root (falls back to window). Returns the first id
 * until a scroll settles, or null when there are no ids.
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
    const scroller: HTMLElement | Window = root ?? window;
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
    scroller.addEventListener("scroll", compute, { passive: true });
    return () => scroller.removeEventListener("scroll", compute);
  }, [key, getRoot, topOffset]);

  return active;
}
