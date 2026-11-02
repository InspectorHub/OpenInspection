import { useLayer } from "@core/shared-ui";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
interface LightboxSlide { src?: string; alt?: string }
/**
 * Plan 7 — a slide may also be a custom video slide ({ type: 'video-stream' }).
 * YARL renders unknown slide types via the `render.slide` callback supplied by
 * the caller (renderSlide). Image slides keep `{ src, alt }`.
 */
export type AnySlide = LightboxSlide | { type: string; [k: string]: unknown };
/**
 * The library pins its toolbar to `top: 0` with a flat 8px padding. In a phone app with `viewport-fit=cover` that puts the
 * first row of buttons under the notch or the status bar. The library reads this variable for the toolbar padding
 * (top, right, bottom, left), so the insets are added there; where there is no inset `env()` is 0 and nothing changes.
 */
const SAFE_AREA_TOOLBAR_PADDING = {
  "--yarl__toolbar_padding": "calc(8px + env(safe-area-inset-top)) calc(8px + env(safe-area-inset-right)) 8px calc(8px + env(safe-area-inset-left))",
} as React.CSSProperties;

/** Isolation wrapper around yet-another-react-lightbox (single-maintainer dep). */
export function PhotoLightbox({ slides, index, open, onClose, toolbarButtons, toolbarWrap, renderSlide }: {
  slides: AnySlide[]; index: number; open: boolean; onClose: () => void;
  /** Custom toolbar nodes rendered before the built-in Close button (YARL v3 `toolbar.buttons`). */
  toolbarButtons?: React.ReactNode[];
  /** Narrow screens: the toolbar spans the full width and wraps onto a second row instead of letting its buttons shrink into each other. */
  toolbarWrap?: boolean;
  /** Plan 7 — render a custom (e.g. video) slide; return undefined to fall back to the default image render. */
  renderSlide?: (slide: AnySlide) => React.ReactNode | undefined;
}) {
  // On the shared layer stack while open: the lightbox listens for Escape on its own element, which a host's window-level
  // back key never reaches. As a layer it is counted by `escapeWillBeHandled` and closed by that same key.
  useLayer(open, { onEscape: onClose, lockScroll: true, traps: true });
  return (
    <Lightbox
      open={open}
      close={onClose}
      index={index}
      // YARL's Slide type is the union of its known slide kinds; our custom
      // video slide is rendered by render.slide, so the cast is intentional.
      slides={slides as unknown as { src: string }[]}
      plugins={[Zoom]}
      zoom={{ maxZoomPixelRatio: 3, doubleTapDelay: 300, pinchZoomDistanceFactor: 100 }}
      toolbar={{ buttons: [...(toolbarButtons ?? []), "close"] }}
      styles={{ toolbar: { ...(toolbarWrap ? { flexWrap: "wrap", left: 0 } : {}), ...SAFE_AREA_TOOLBAR_PADDING } }}
      render={renderSlide ? { slide: ({ slide }) => renderSlide(slide as unknown as AnySlide) || undefined } : undefined}
    />
  );
}
