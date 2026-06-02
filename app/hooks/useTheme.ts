import { useState, useEffect, useCallback } from "react";
import { useRouteLoaderData } from "react-router";
import { writeColorSchemeCookie, type UiPrefs } from "~/lib/ui-prefs";

type ColorScheme = "light" | "dark" | "auto";

function resolveScheme(scheme: ColorScheme): "light" | "dark" {
  if (scheme !== "auto") return scheme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyScheme(scheme: ColorScheme) {
  const resolved = resolveScheme(scheme);
  const root = document.documentElement;
  root.setAttribute("data-color-scheme", resolved);
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function useTheme() {
  // Initial scheme comes from the cookie-backed root loader so the server and the
  // client's first render agree (no hydration mismatch). localStorage is no longer
  // read during render — it would be invisible to the server.
  const rootPrefs = useRouteLoaderData("root") as UiPrefs | undefined;
  const [scheme, setScheme] = useState<ColorScheme>(rootPrefs?.colorScheme ?? "auto");

  useEffect(() => {
    applyScheme(scheme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      if (scheme === "auto") applyScheme("auto");
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [scheme]);

  const setColorScheme = useCallback((next: ColorScheme) => {
    setScheme(next);
    // Cookie is the SSR source of truth; keep localStorage in sync for legacy reads.
    writeColorSchemeCookie(next);
    try {
      if (next === "auto") {
        localStorage.removeItem("oi-color-scheme");
      } else {
        localStorage.setItem("oi-color-scheme", next);
      }
    } catch { /* ignore persistence errors */ }
    applyScheme(next);
  }, []);

  return { scheme, resolved: resolveScheme(scheme), setColorScheme } as const;
}
