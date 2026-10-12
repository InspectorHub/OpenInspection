import { useEffect, useRef } from "react";

interface Layer {
  /** When this layer opened, in render order: a parent renders before the children it contains. */
  order: number;
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
 * the render-time sequence puts the contained layer on top however the commit runs.
 */
const layers: Layer[] = [];

let nextOrder = 0;
let scrollLocks = 0;
let scrollBefore = "";

function onWindowKeyDown(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  // A widget that already used this Escape (closed its own suggestion list, reverted
  // an edit) calls preventDefault() in its React handler, which runs before this one.
  if (e.defaultPrevented) return;
  const top = layers[layers.length - 1];
  const handler = top?.getEscape();
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

/** True while at least one layer is open. For window-level hotkeys that are not layers. */
export function hasOpenLayer(): boolean {
  return layers.length > 0;
}

/**
 * Registers an overlay on the shared layer stack while `open`. The effect is keyed on
 * `open` only; `onEscape` is read through a ref so an inline arrow never re-registers
 * the layer (which would reorder the stack and, for dialogs, steal focus).
 */
export function useLayer(
  open: boolean,
  opts: { onEscape?: () => void; lockScroll?: boolean } = {},
): { isTop: () => boolean; closedAsTop: () => boolean } {
  const onEscapeRef = useRef(opts.onEscape);
  useEffect(() => {
    onEscapeRef.current = opts.onEscape;
  });
  const layerRef = useRef<Layer | null>(null);
  const isTopRef = useRef(() => {
    const me = layerRef.current;
    return me !== null && layers[layers.length - 1] === me;
  });
  // Set by the cleanup below so an effect declared AFTER this hook (whose cleanup runs
  // after ours) can still ask whether the layer was on top at the moment it closed.
  const closedAsTopRef = useRef(false);
  const closedAsTopFn = useRef(() => closedAsTopRef.current);
  const lockScroll = opts.lockScroll === true;
  // Claimed on the first render that sees `open`, released when it closes: see the docstring.
  const orderRef = useRef(0);
  if (open && orderRef.current === 0) orderRef.current = ++nextOrder;
  if (!open) orderRef.current = 0;

  useEffect(() => {
    if (!open) return;
    // A fresh object per registration so StrictMode's mount/unmount/mount stays balanced.
    const layer: Layer = { order: orderRef.current, getEscape: () => onEscapeRef.current };
    layerRef.current = layer;
    closedAsTopRef.current = false;
    addLayer(layer);
    const locked = lockScroll;
    if (locked && scrollLocks++ === 0) {
      scrollBefore = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      closedAsTopRef.current = layers[layers.length - 1] === layer;
      removeLayer(layer);
      if (layerRef.current === layer) layerRef.current = null;
      if (locked && --scrollLocks === 0) document.body.style.overflow = scrollBefore;
    };
    // Keyed on [open] only by design: see the docstring.
  }, [open]);

  return { isTop: isTopRef.current, closedAsTop: closedAsTopFn.current };
}
