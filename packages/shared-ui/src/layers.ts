import { useEffect, useRef, useState } from "react";

interface Layer {
  /** When this layer opened, in render order: a parent renders before the children it contains. */
  order: number;
  /** True for dialogs that hold keyboard focus inside themselves (Modal, Drawer). */
  traps: boolean;
  /** The current Escape handler, or undefined when this layer does not answer Escape. */
  getEscape: () => (() => void) | undefined;
}

/**
 * Every overlay that is open right now (dialogs, drawers, popovers, menus), in the
 * order they opened. Only the topmost answers Escape, and the body scroll lock is
 * counted across all of them.
 *
 * Module state is shared by every importer, SSR requests included. The stack and the
 * scroll lock are touched only inside effects, which never run on the server. The one
 * thing written during render is `nextOrder`, a plain integer that is never read on the
 * server, so it cannot carry anything from one request to another.
 *
 * Stack order is the order layers OPENED in, taken at render time rather than effect time:
 * React runs child effects before the parent's, so by effect order a layer that mounts open
 * inside another one (a popover inside a modal, both rendered open together) would land
 * underneath its own container. A parent always renders before its children, so ordering by
 * the render-time sequence puts the contained layer on top however the commit runs. The
 * sequence number lives in state that is set while rendering, so a render React throws away
 * (an interrupted transition, a Suspense retry) throws its number away with it.
 *
 * Register a layer only while it is actually on screen. A layer that is open but invisible
 * (rendered null, hidden by CSS) would still take Escape.
 */
const layers: Layer[] = [];

let nextOrder = 0;
let scrollLocks = 0;
let scrollBefore = "";
const LOCKED = "hidden";

function onWindowKeyDown(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  // A widget that already used this Escape (closed its own suggestion list, reverted
  // an edit) calls preventDefault() in its React handler, which runs before this one.
  if (e.defaultPrevented) return;
  // Escape that cancels an IME composition belongs to the input method, not to the overlay.
  if (e.isComposing) return;
  const handler = layers[layers.length - 1]?.getEscape();
  if (!handler) return;
  e.preventDefault();
  handler();
}

function addLayer(layer: Layer): void {
  if (layers.length === 0) window.addEventListener("keydown", onWindowKeyDown);
  // Insert by opening order (stable for equal orders), not by whenever the effect ran.
  let at = layers.length;
  while (at > 0 && layers[at - 1].order > layer.order) at--;
  layers.splice(at, 0, layer);
}

function removeLayer(layer: Layer): void {
  const at = layers.indexOf(layer);
  if (at >= 0) layers.splice(at, 1);
  if (layers.length === 0) window.removeEventListener("keydown", onWindowKeyDown);
}

/** True while at least one layer is open. */
export function hasOpenLayer(): boolean {
  return layers.length > 0;
}

/**
 * True when the next Escape will be taken by an overlay. For window-level hotkeys that are
 * not layers: they must skip Escape exactly when a layer will answer it, and not when a
 * layer is open that does not answer Escape.
 */
export function escapeWillBeHandled(): boolean {
  return layers[layers.length - 1]?.getEscape() !== undefined;
}

export interface LayerHandle {
  /** This layer is the topmost one right now. */
  isTop: () => boolean;
  /**
   * What sits above this layer: nothing, only overlays that do not trap focus (a popover,
   * a menu), or another trapping dialog.
   */
  coverage: () => "none" | "overlay" | "dialog";
  /** Whether this layer was the topmost one at the moment it last closed. */
  closedAsTop: () => boolean;
}

/**
 * Registers an overlay on the shared layer stack while `open`. The effect is keyed on
 * `open` only; `onEscape` is read through a ref so an inline arrow never re-registers
 * the layer (which would reorder the stack and, for dialogs, steal focus).
 */
export function useLayer(
  open: boolean,
  opts: { onEscape?: () => void; lockScroll?: boolean; traps?: boolean } = {},
): LayerHandle {
  const onEscapeRef = useRef(opts.onEscape);
  useEffect(() => {
    onEscapeRef.current = opts.onEscape;
  });
  // Claimed while rendering the first render that sees `open`, released when it closes.
  const [order, setOrder] = useState(0);
  if (open && order === 0) setOrder(++nextOrder);
  if (!open && order !== 0) setOrder(0);

  const lockScroll = opts.lockScroll === true;
  const traps = opts.traps === true;
  const state = useRef<{ layer: Layer | null; closedAsTop: boolean; handle: LayerHandle | null }>({
    layer: null,
    closedAsTop: false,
    handle: null,
  });
  if (state.current.handle === null) {
    const s = state.current;
    s.handle = {
      isTop: () => s.layer !== null && layers[layers.length - 1] === s.layer,
      coverage: () => {
        const at = s.layer ? layers.indexOf(s.layer) : -1;
        if (at < 0) return "none";
        const above = layers.slice(at + 1);
        if (above.length === 0) return "none";
        return above.some((l) => l.traps) ? "dialog" : "overlay";
      },
      closedAsTop: () => s.closedAsTop,
    };
  }

  useEffect(() => {
    if (!open) return;
    const s = state.current;
    // A fresh object per registration so StrictMode's mount/unmount/mount stays balanced.
    const layer: Layer = { order, traps, getEscape: () => onEscapeRef.current };
    s.layer = layer;
    s.closedAsTop = false;
    addLayer(layer);
    if (lockScroll && scrollLocks++ === 0) {
      scrollBefore = document.body.style.overflow;
      document.body.style.overflow = LOCKED;
    }
    return () => {
      s.closedAsTop = layers[layers.length - 1] === layer;
      removeLayer(layer);
      if (s.layer === layer) s.layer = null;
      // Restore only while the page is still locked the way we locked it: if some other
      // writer has changed overflow since, its value is not ours to overwrite.
      if (lockScroll && --scrollLocks === 0 && document.body.style.overflow === LOCKED) {
        document.body.style.overflow = scrollBefore;
      }
    };
    // Keyed on [open] only by design: see the docstring.
  }, [open]);

  return state.current.handle as LayerHandle;
}
