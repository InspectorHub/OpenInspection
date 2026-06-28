import { useEffect, useState } from "react";
import { useNavigation } from "react-router";

/**
 * Global navigation progress bar (issue #202, Tier 1). React Router runs a
 * route's loader BEFORE it swaps the page in, so a click can sit silent for a
 * beat while data is fetched — users read that as "the app froze." This thin top
 * bar gives immediate feedback: it ramps toward 90% while a navigation is in
 * flight, then snaps to 100% and fades once the new route is committed.
 *
 * It keys off `navigation.state` only, so it self-resolves on success AND on
 * error/404 (a thrown loader Response still returns the state to "idle", which
 * triggers the fade-out) — no stuck-forever bar. Uses the Design System 0523
 * `--ih-primary` accent so it tracks light/dark/field themes automatically.
 */
export function NavProgress() {
  const navigation = useNavigation();
  const active = navigation.state !== "idle";
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (active) {
      setVisible(true);
      setWidth(8);
      const id = window.setInterval(() => {
        // Ease toward 90% — never reaches it, so the bar keeps inching while we wait.
        setWidth((w) => (w >= 90 ? w : w + Math.max(0.5, (90 - w) * 0.1)));
      }, 200);
      return () => window.clearInterval(id);
    }
    // Navigation settled (committed OR errored) → complete, then fade out.
    setWidth(100);
    const hide = window.setTimeout(() => setVisible(false), 250);
    const reset = window.setTimeout(() => setWidth(0), 520);
    return () => {
      window.clearTimeout(hide);
      window.clearTimeout(reset);
    };
  }, [active]);

  if (!visible) return null;
  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[200] h-[3px] pointer-events-none"
    >
      <div
        className="h-full bg-ih-primary shadow-[0_0_8px_var(--ih-primary-glow)] transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `${width}%`, opacity: width >= 100 ? 0 : 1 }}
      />
    </div>
  );
}
