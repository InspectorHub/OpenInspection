import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getBrowserTimeZone, TIMEZONE_OPTIONS } from "~/lib/timezones";

/**
 * Viewer timezone for public, unauthenticated surfaces that carry no tenant
 * (observe / verify / concierge / agreement-printable). These links have no
 * session context and no tenant slug, so there is no configured zone to anchor
 * to — the honest anchor is the viewer's own zone. Mainstream field-service
 * tools resolve times to the viewer's browser zone rather than defaulting
 * silently to UTC, and let them pick another zone when the guess is wrong.
 *
 * SSR-safe by construction: the initial value is "UTC" on the server AND on the
 * first client render, so hydration matches. After mount the effect resolves the
 * effective zone (a remembered choice from a prior visit, else the browser zone)
 * and the displayed times settle to it. No-JS / PDF-render viewers keep the UTC
 * anchor, which is the correct fixed fallback for a printed document.
 */

const STORAGE_KEY = "oi-viewer-tz";

interface ViewerTimeZoneState {
  /** The zone all dates on the page are rendered in ("UTC" until resolved). */
  tz: string;
  /** Adopt + remember a zone chosen from the notice control. */
  setTz: (tz: string) => void;
  /** The browser's own detected zone, or null before mount / if unresolvable.
   *  Drives whether the notice control has anything meaningful to show. */
  detected: string | null;
}

const ViewerTimeZoneContext = createContext<ViewerTimeZoneState | null>(null);

export function ViewerTimeZoneProvider({ children }: { children: ReactNode }) {
  const [tz, setTzState] = useState("UTC");
  const [detected, setDetected] = useState<string | null>(null);

  useEffect(() => {
    const browser = getBrowserTimeZone();
    setDetected(browser);
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* private mode / storage blocked — fall back to detection */
    }
    // Prefer a remembered choice, then the detected zone, but only adopt a zone
    // the picker can actually represent (some runtimes report a non-canonical
    // alias with no matching <option>). Otherwise stay on the UTC anchor.
    const next =
      stored && TIMEZONE_OPTIONS.includes(stored)
        ? stored
        : browser && TIMEZONE_OPTIONS.includes(browser)
          ? browser
          : "UTC";
    setTzState(next);
  }, []);

  const setTz = useCallback((next: string) => {
    setTzState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked — the choice still applies for this page view */
    }
  }, []);

  return (
    <ViewerTimeZoneContext.Provider value={{ tz, setTz, detected }}>
      {children}
    </ViewerTimeZoneContext.Provider>
  );
}

/** The zone to render dates in. Returns "UTC" outside a provider (SSR-safe). */
export function useViewerTimeZone(): string {
  return useContext(ViewerTimeZoneContext)?.tz ?? "UTC";
}

/** Full state for the notice control (zone + setter + detected zone). */
export function useViewerTimeZoneControls(): ViewerTimeZoneState {
  return (
    useContext(ViewerTimeZoneContext) ?? {
      tz: "UTC",
      setTz: () => {},
      detected: null,
    }
  );
}
