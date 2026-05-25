import { useEffect } from "react";

interface KeyboardHandlers {
  onRate: (level: number) => void;  // 1-5
  onNextItem: () => void;           // J or ArrowDown
  onPrevItem: () => void;           // K or ArrowUp
  onToggleSpeed: () => void;        // Z
  onOpenLibrary: () => void;        // /
  onPhoto: () => void;              // P
}

export function useKeyboard(handlers: KeyboardHandlers, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    const handle = (e: KeyboardEvent) => {
      // Don't trigger in inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key >= "1" && e.key <= "5") { handlers.onRate(parseInt(e.key)); e.preventDefault(); }
      if (e.key === "j" || e.key === "ArrowDown") { handlers.onNextItem(); e.preventDefault(); }
      if (e.key === "k" || e.key === "ArrowUp") { handlers.onPrevItem(); e.preventDefault(); }
      if (e.key === "z") { handlers.onToggleSpeed(); e.preventDefault(); }
      if (e.key === "/") { handlers.onOpenLibrary(); e.preventDefault(); }
      if (e.key === "p") { handlers.onPhoto(); e.preventDefault(); }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [handlers, enabled]);
}
