import { useEffect } from 'react';

/** Opening Inspection Details starts at its top: the phone page scrolls the window, the other trees scroll their own pane. */
export function useScrollTopOnDetails(activeView: string): void {
  useEffect(() => {
    if (activeView !== 'property') return;
    window.scrollTo(0, 0);
    document.querySelectorAll('main').forEach((el) => {
      el.scrollTop = 0;
    });
  }, [activeView]);
}
