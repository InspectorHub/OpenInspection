import { useState, useEffect, useCallback } from "react";

type ColorScheme = "light" | "dark" | "auto";

function getStoredScheme(): ColorScheme {
  if (typeof window === "undefined") return "auto";
  try {
    const v = localStorage.getItem("oi-color-scheme");
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "auto";
}

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
  const [scheme, setScheme] = useState<ColorScheme>(getStoredScheme);

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
    try {
      if (next === "auto") {
        localStorage.removeItem("oi-color-scheme");
      } else {
        localStorage.setItem("oi-color-scheme", next);
      }
    } catch {}
    applyScheme(next);
  }, []);

  return { scheme, resolved: resolveScheme(scheme), setColorScheme } as const;
}
