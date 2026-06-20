import { useEffect, type RefObject } from "react";

declare global {
  interface Window {
    onTurnstileLoad?: () => void;
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void },
      ) => void;
    };
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
) {
  // Load Turnstile widget
  useEffect(() => {
    if (!siteKey || typeof window === "undefined") return;
    const existing = document.querySelector('script[src*="turnstile"]');
    if (!existing) {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
      s.async = true;
      document.head.appendChild(s);
    }
    window.onTurnstileLoad = () => {
      if (turnstileRef.current && window.turnstile) {
        window.turnstile.render(turnstileRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onToken(token),
        });
      }
    };
    if (window.turnstile && turnstileRef.current) {
      window.turnstile.render(turnstileRef.current, {
        sitekey: siteKey,
        callback: (token: string) => onToken(token),
      });
    }
  }, [siteKey, step]);
}
