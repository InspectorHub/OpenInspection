import { useEffect, type RefObject } from "react";

declare global {
  interface Window {
    onTurnstileLoad?: () => void;
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          theme: "light" | "dark" | "auto";
          callback: (token: string) => void;
        },
      ) => void;
    };
  }
}

/**
 * Which theme to hand Turnstile, read off the scheme the page is painted with.
 *
 * Turnstile's default is `auto`, and Cloudflare defines that as respecting
 * "the visitor preference" — `prefers-color-scheme`, the OS setting. That is
 * NOT this app's theme: `oi-color-scheme` is an explicit cookie the visitor
 * chooses, resolved onto `<html data-color-scheme>` before first paint by the
 * boot script in root.tsx. The two disagree precisely when someone has set a
 * preference, which is what a preference is for — a dark widget stranded in a
 * light booking form, or the reverse.
 *
 * `auto` is passed through rather than resolved here: in that mode our own CSS
 * is on `prefers-color-scheme` as well, so Turnstile's `auto` already matches
 * the page — and goes on matching it if the OS flips mid-visit, which a value
 * frozen at render time would not.
 */
function widgetTheme(): "light" | "dark" | "auto" {
  if (typeof document === "undefined") return "auto";
  switch (document.documentElement.getAttribute("data-color-scheme")) {
    case "light":
      return "light";
    // `field` is the dark-based high-contrast scheme (root.tsx gives it the
    // `.dark` class for the same reason); Turnstile offers no third option.
    case "dark":
    case "field":
      return "dark";
    default:
      return "auto";
  }
}

/**
 * Loads the Cloudflare Turnstile widget script and renders the widget into
 * `turnstileRef` whenever `siteKey` is present. Re-runs when `step` changes so
 * the widget re-renders after navigation (the confirm step mounts the host
 * element). Calls `onToken` with the solved token.
 */
export function useTurnstileWidget(
  siteKey: string | null | undefined,
  turnstileRef: RefObject<HTMLDivElement | null>,
  step: number,
  onToken: (token: string) => void,
  /**
   * Called when the challenge SCRIPT itself cannot be fetched.
   *
   * Without this the failure is completely silent: `onTurnstileLoad` never
   * fires, nothing renders where the widget should be, and the caller is left
   * waiting for a token that can never arrive. On a network that cannot reach
   * challenges.cloudflare.com that is a permanent dead end on a page whose
   * whole job is to take a booking, so the caller needs to be able to say so.
   */
  onLoadFailed?: () => void,
) {
  // Load Turnstile widget
  useEffect(() => {
    if (!siteKey || typeof window === "undefined") return;
    const existing = document.querySelector('script[src*="turnstile"]');
    if (!existing) {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
      s.async = true;
      s.onerror = () => onLoadFailed?.();
      document.head.appendChild(s);
    }
    window.onTurnstileLoad = () => {
      if (turnstileRef.current && window.turnstile) {
        window.turnstile.render(turnstileRef.current, {
          sitekey: siteKey,
          theme: widgetTheme(),
          callback: (token: string) => onToken(token),
        });
      }
    };
    if (window.turnstile && turnstileRef.current) {
      window.turnstile.render(turnstileRef.current, {
        sitekey: siteKey,
        theme: widgetTheme(),
        callback: (token: string) => onToken(token),
      });
    }
  }, [siteKey, step]);
}
