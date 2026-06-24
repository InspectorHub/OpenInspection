import { useEffect, useRef } from "react";
import { singleKeyShortcutsAllowed } from "../lib/shortcut-scope";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface KeyboardHandlers {
  // Rating: 1-5 maps to rating levels, 0 clears, N = N/A
  onRate: (level: number) => void;
  onClearRating: () => void;
  onNARating: () => void;

  // Navigation
  onNextItem: () => void;
  onPrevItem: () => void;

  // Speed mode
  onToggleSpeed: () => void;
  speedMode: boolean;
  onSpeedRate?: (idx: number) => void;
  onSpeedNext?: () => void;
  onSpeedPrev?: () => void;
  onSpeedOpenEditor?: () => void;

  // Comment library
  onOpenLibrary: () => void;
  onOpenSnippets: () => void;
  showCommentLibrary: boolean;
  onLibraryDown?: () => void;
  onLibraryUp?: () => void;
  onLibrarySelect?: () => void;
  onLibraryClose?: () => void;

  // Actions
  onPhoto: () => void;
  onSave: () => void;
  onPublish: () => void;
  /** Workflow shortcuts PR — R key clones the previous item via tenant scope default. */
  onCloneLast: () => void;
  onSaveAsSnippet: () => void;
  onToggleCheatsheet: () => void;

  // G-prefix
  onGotoSection: (idx: number) => void;
  onOpenSectionPicker: () => void;

  // Tags
  onOpenTagPicker: () => void;

  // Fullscreen
  onToggleFullscreen: () => void;
  onExitFullscreen: () => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useKeyboard(
  handlers: KeyboardHandlers,
  enabled = true,
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const gPrefixRef = useRef(false);
  const gPrefixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function isInField(): boolean {
      const tag = (document.activeElement as HTMLElement)?.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
        return true;
      if ((document.activeElement as HTMLElement)?.isContentEditable)
        return true;
      return false;
    }

    function handle(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return;
      const h = handlersRef.current;
      const inField = isInField();
      const meta = e.metaKey || e.ctrlKey;

      // Meta-prefixed hotkeys (work even in fields)
      if (meta) {
        if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          h.onSave();
          return;
        }
        if ((e.key === "p" || e.key === "P") && e.shiftKey) {
          e.preventDefault();
          h.onPublish();
          return;
        }
        if (e.key === "d" || e.key === "D") {
          e.preventDefault();
          h.onSaveAsSnippet();
          return;
        }
        if (e.key === "Enter" && h.showCommentLibrary) {
          e.preventDefault();
          h.onLibrarySelect?.();
          return;
        }
        return;
      }

      // Z = toggle speed mode (outside fields)
      if ((e.key === "z" || e.key === "Z") && !inField) {
        e.preventDefault();
        h.onToggleSpeed();
        return;
      }

      // Speed mode intercepts
      if (h.speedMode) {
        if (e.key >= "1" && e.key <= "5") {
          e.preventDefault();
          h.onSpeedRate?.(parseInt(e.key, 10) - 1);
          return;
        }
        if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          h.onSpeedNext?.();
          return;
        }
        if (e.key === "Tab" && e.shiftKey) {
          e.preventDefault();
          h.onSpeedPrev?.();
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          h.onSpeedNext?.();
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          h.onSpeedPrev?.();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          h.onSpeedOpenEditor?.();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          h.onToggleSpeed();
          return;
        }
      }

      // Comment library intercepts
      if (h.showCommentLibrary) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          h.onLibraryDown?.();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          h.onLibraryUp?.();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          h.onLibrarySelect?.();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          h.onLibraryClose?.();
          return;
        }
      }

      if (e.altKey) return;
      if (inField) {
        if (e.key === "Escape" && h.showCommentLibrary) {
          h.onLibraryClose?.();
        }
        return;
      }

      // Escape closes library
      if (e.key === "Escape" && h.showCommentLibrary) {
        e.preventDefault();
        h.onLibraryClose?.();
        return;
      }

      // Escape exits fullscreen (when library is not open)
      if (e.key === "Escape") {
        h.onExitFullscreen();
        return;
      }

      // G-prefix mode
      if (gPrefixRef.current && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        gPrefixRef.current = false;
        if (gPrefixTimerRef.current) clearTimeout(gPrefixTimerRef.current);
        h.onGotoSection(parseInt(e.key, 10));
        return;
      }
      if (gPrefixRef.current && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        gPrefixRef.current = false;
        if (gPrefixTimerRef.current) clearTimeout(gPrefixTimerRef.current);
        h.onOpenSectionPicker();
        return;
      }
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        gPrefixRef.current = true;
        if (gPrefixTimerRef.current) clearTimeout(gPrefixTimerRef.current);
        gPrefixTimerRef.current = setTimeout(() => {
          gPrefixRef.current = false;
        }, 1500);
        return;
      }

      // Single-key shortcuts are scoped: only fire when focus is on <body>
      // or inside a container with data-shortcut-scope (B-19a).
      if (!singleKeyShortcutsAllowed(document.activeElement, e.isComposing)) return;

      // ? = toggle cheatsheet
      if (e.key === "?") {
        e.preventDefault();
        h.onToggleCheatsheet();
        return;
      }

      // / = open comment library
      if (e.key === "/") {
        e.preventDefault();
        h.onOpenLibrary();
        return;
      }

      // ; = open snippets
      if (e.key === ";") {
        e.preventDefault();
        h.onOpenSnippets();
        return;
      }

      // T = open tag picker
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        h.onOpenTagPicker();
        return;
      }

      // F = toggle item fullscreen
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        h.onToggleFullscreen();
        return;
      }

      // Navigation: J/K, ArrowUp/ArrowDown, Enter
      if (
        e.key === "ArrowDown" ||
        e.key === "j" ||
        e.key === "J" ||
        (e.key === "Enter" && !e.shiftKey)
      ) {
        e.preventDefault();
        h.onNextItem();
        return;
      }
      if (
        e.key === "ArrowUp" ||
        e.key === "k" ||
        (e.key === "Enter" && e.shiftKey)
      ) {
        e.preventDefault();
        h.onPrevItem();
        return;
      }

      // R = clone last (uses tenant default scope, set by inspection-edit).
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        h.onCloneLast();
        return;
      }

      // P = add photo
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        h.onPhoto();
        return;
      }

      // Rating shortcuts: 1-5, 0 clear, N = N/A
      if (e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        h.onRate(parseInt(e.key, 10));
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        h.onClearRating();
        return;
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        h.onNARating();
        return;
      }
    }

    window.addEventListener("keydown", handle);
    return () => {
      window.removeEventListener("keydown", handle);
      if (gPrefixTimerRef.current) clearTimeout(gPrefixTimerRef.current);
    };
  }, [enabled]);
}
